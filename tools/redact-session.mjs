// 只读会话窗口提取 + 脱敏（供 special fixtures 生成）。
// 复用 M0 的脱敏规则：ID 伪名化、时间重定基、seq 重编号、正文/参数/路径全替换。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const SALT = 'M1-Special-2026';
const BASE_TIME = Date.UTC(2026, 1, 1, 0, 0, 0);
const hex = (value, n) => crypto.createHash('sha256').update(SALT + '|' + value).digest('hex').slice(0, n);
const pseudoUuid = (value) => {
  const h = hex('uuid:' + value, 32);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
};
const pseudoId = (key, value) => {
  const s = String(value);
  if (key === 'callId' || key === 'toolCallId') return 'call_' + hex('call:' + s, 27);
  if (key === 'jobId') return 'job_' + hex(key + ':' + s, 16);
  if (key === 'owner' || key === 'sessionId') return pseudoUuid('sid:' + s);
  if (key === 'commandId') return 'cmd_' + hex(key + ':' + s, 8);
  return pseudoUuid(key + ':' + s);
};

const ID_KEYS = new Set(['id', 'callId', 'toolCallId', 'jobId', 'owner', 'childId', 'teamId', 'compactionId', 'retryId', 'commandId', 'rpcId', 'sessionId', 'requestId', 'parentSessionId']);
const TIME_KEYS = new Set(['time', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt', 'childCreatedAt']);
const SAFE_STRING_KEYS = new Set(['type', 'kind', 'status', 'outcome', 'role', 'phase', 'level', 'decision', 'provider', 'model', 'policy', 'preset', 'mode', 'cause', 'context', 'action', 'state', 'operation', 'lang', 'shape', 'agentProvider', 'agentModel', 'agentReasoningEffort', 'agentPreset', 'clientTimeZone', 'source', 'target', 'toolName', 'mimeType', 'mediaType', 'currency', 'code']);
const SAFE_ENUM = /^[A-Za-z0-9_./:\- ]{1,80}$/;
export const KEEP_TYPES = new Set([
  'permission/preset', 'sandbox/mode', 'approval/policy', 'subagent/descriptor',
  'turn/start', 'step/start', 'step/end', 'turn/end', 'system/message', 'user/message', 'assistant/message',
  'tool/call', 'tool/result', 'approval/asked', 'approval/decided', 'job/registered', 'job/settled',
  'agent/inbox/spliced', 'session/title', 'todo/write', 'workspace/changes', 'deliverables/presented',
  'goal/change', 'team/member', 'team/task', 'subagent/catalog', 'session/end-seed',
  'command/run', 'command/done', 'assistant/attempt', 'llm/retry', 'llm/retry-started',
  'compaction/start', 'compaction/end', 'compaction/prune',
]);
const DROP_PATHS = {
  'assistant/message': new Set(['data.stream', 'data.message.source.replayState']),
};

export function readSession(file) {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8');
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const header = records[0];
  const events = header && header.type === 'session' ? records.slice(1) : records;
  return { header, events };
}

function sanitizeValue(value, p, ctx) {
  const key = p.split('.').pop();
  if (value === null) return null;
  if (typeof value === 'number') return TIME_KEYS.has(key) ? ctx.base + (value - ctx.firstTime) : value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (ID_KEYS.has(key)) return pseudoId(key, value);
    if (SAFE_STRING_KEYS.has(key) && SAFE_ENUM.test(value)) return value;
    if (ctx.keepToolName && p === 'data.name') return SAFE_ENUM.test(value) ? value : '<redacted>';
    return '<redacted:' + value.length + ' chars>';
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, p + '[]', ctx));
  const drops = DROP_PATHS[ctx.type];
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (drops && drops.has(p + '.' + k)) continue;
    out[k] = sanitizeValue(v, p + '.' + k, ctx);
  }
  return out;
}

/**
 * 从真实会话中截取 seq 窗口并脱敏。
 * @param {string} file
 * @param {Array<[number, number]>} ranges 原始 seq 闭区间
 * @param {{baseOffset?: number, purpose?: string}} [options]
 */
export function extractWindow(file, ranges, options = {}) {
  const { header, events } = readSession(file);
  const selected = events.filter((event) => ranges.some(([from, to]) => event.seq >= from && event.seq <= to));
  selected.sort((a, b) => a.seq - b.seq);
  const keep = selected.filter((event) => KEEP_TYPES.has(event.type));
  const seqMap = new Map();
  keep.forEach((event, index) => seqMap.set(event.seq, index));
  const firstTime = Math.min(...keep.map((event) => (Number.isFinite(event.time) ? event.time : Infinity)));
  const base = BASE_TIME + (options.baseOffset || 0);
  const ctx = { base, firstTime, type: undefined, keepToolName: false };
  const headerOut = {
    type: 'session',
    version: 4,
    id: header.delegationDepth > 0 ? pseudoUuid('sid:' + header.id) : 'session-' + pseudoUuid('sid:' + header.id),
    createdAt: base - 60000,
    cwd: '<workspace>',
    isSeeded: false,
    delegationDepth: header.delegationDepth,
    agentPreset: SAFE_ENUM.test(String(header.agentPreset)) ? header.agentPreset : 'standard',
  };
  const lines = [JSON.stringify(headerOut)];
  for (const event of keep) {
    ctx.type = event.type;
    ctx.keepToolName = event.type === 'tool/call';
    const out = {
      type: event.type,
      seq: seqMap.get(event.seq),
      time: base + (event.time - firstTime),
      data: sanitizeValue(event.data === undefined ? {} : event.data, 'data', ctx),
    };
    if (event.surfaceOp !== undefined && SAFE_ENUM.test(String(event.surfaceOp))) out.surfaceOp = String(event.surfaceOp);
    if (Array.isArray(event.sourceEventSeqs)) {
      const mapped = event.sourceEventSeqs.filter((s) => seqMap.has(s)).map((s) => seqMap.get(s));
      if (mapped.length) out.sourceEventSeqs = mapped;
    }
    lines.push(JSON.stringify(out));
  }
  return {
    lines,
    provenance: {
      sourceSessionIdSha8: crypto.createHash('sha256').update(String(header.id)).digest('hex').slice(0, 8),
      sourceDelegationDepth: header.delegationDepth,
      originalRanges: ranges,
      eventCount: keep.length,
      purpose: options.purpose || null,
      sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'),
    },
  };
}

export function writeFixture(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

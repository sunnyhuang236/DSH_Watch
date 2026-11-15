// 生成 M1 专项样本（fixtures/special/）：
//   真实窗口：审批（多审批）、提问等待、LLM 重试（真实 error-adjacent 事件）
//   合成样本：failed 终态、审批 rejected/cancelled/unavailable、等待提问中被取消
// 真实窗口做脱敏；合成样本按 DSH 源码中的事件/字段形状构造，并标注 synthetic。
// 用法: node tools/make-special-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSession, extractWindow, writeFixture } from './redact-session.mjs';
import { WatchStore } from '../packages/dsh-watch/lib/core/store.mjs';
import { Ingestor } from '../packages/dsh-watch/lib/core/pipeline.mjs';
import { sessionMeta } from '../packages/dsh-watch/lib/core/normalize.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'sessions');
const OUT_DIR = path.join(REPO, 'fixtures', 'special');
const sha8 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && /session\.v\d+\.jsonl\.zstd$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function stateOfLines(lines) {
  const records = lines.map((line) => JSON.parse(line));
  const header = records[0];
  const events = records.slice(1);
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  const meta = sessionMeta(header);
  ingestor.ingestSessionEvents(meta, events);
  const snapshot = store.getTask(meta.task_id);
  const result = {
    taskId: meta.task_id,
    state: snapshot ? snapshot.state : null,
    summary: snapshot ? snapshot.summary : null,
    events: ingestor.stats.ingested,
    ignored: ingestor.stats.ignored,
    errors: ingestor.stats.errors,
  };
  store.close();
  return result;
}

const provenance = [];
const consoleLines = [];
function record(kind, file, entry) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const info = stateOfLines(lines);
  const sha256 = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  const synthetic = entry.synthetic !== undefined ? entry.synthetic : kind.startsWith('synthetic');
  provenance.push({ file: path.relative(REPO, file).replace(/\\/g, '/'), kind, synthetic, sha256, expected: info, ...entry });
  consoleLines.push(kind + ' → ' + path.relative(REPO, file) + ' events=' + info.events + ' state=' + info.state + ' summary=' + info.summary);
}

// ---------- 真实窗口 ----------
const sessions = [];
for (const file of walk(ROOT).sort()) {
  try {
    const { header, events } = readSession(file);
    if (!header || header.type !== 'session') continue;
    sessions.push({ file, header, events });
  } catch { /* 跳过读不完整的日志 */ }
}

function findRealWindow(candidates, pick) {
  let best = null;
  for (const session of sessions) {
    const found = candidates(session);
    if (!found) continue;
    if (!best || pick(found, best)) best = { session, ...found };
  }
  return best;
}

// 1) 真实多审批窗口：同一 turn 内 ≥2 次审批，取窗口最小的 turn
const multiApproval = findRealWindow(({ events }) => {
  const asked = events.filter((event) => event.type === 'approval/asked' && event.data);
  if (asked.length < 2) return null;
  const turnOf = (seq) => {
    let turn = null;
    for (const event of events) { if (event.seq > seq) break; if (event.type === 'turn/start') turn = event.data.turn; }
    return turn;
  };
  const byTurn = new Map();
  for (const event of asked) {
    const turn = turnOf(event.seq);
    if (!byTurn.has(turn)) byTurn.set(turn, []);
    byTurn.get(turn).push(event);
  }
  let bestWindow = null;
  for (const [turn, list] of byTurn) {
    if (list.length < 2) continue;
    const first = list[0];
    const second = list[1];
    const turnStart = events.find((event) => event.type === 'turn/start' && event.data.turn === turn);
    const turnEnd = events.find((event) => event.type === 'turn/end' && event.data.turn === turn);
    if (!turnStart || !turnEnd) continue;
    const start = Math.max(turnStart.seq, first.seq - 15);
    const end = Math.min(turnEnd.seq, second.seq + 30);
    if (end - start < 8) continue;
    if (!bestWindow || end - start < bestWindow.end - bestWindow.start) bestWindow = { start, end, turn, approvals: 2 };
  }
  return bestWindow ? { window: bestWindow, sessionSha8: sha8(events[0] && events[0].type === 'session' ? '' : '') } : null;
}, (found, best) => found.window.end - found.window.start < best.window.end - best.window.start);
if (multiApproval) {
  const file = path.join(OUT_DIR, 'real-multi-approval-window.jsonl');
  const { lines, provenance: meta } = extractWindow(multiApproval.session.file, [[multiApproval.window.start, multiApproval.window.end]], {
    baseOffset: 0, purpose: '真实多审批窗口（同一 turn）',
  });
  writeFixture(file, lines);
  record('real-multi-approval', file, { ...meta, sourceSessionIdSha8: sha8(multiApproval.session.header.id), sourceDelegationDepth: multiApproval.session.header.delegationDepth });
}

// 2) 真实提问等待窗口（最长等待）
const question = findRealWindow(({ events }) => {
  let best = null;
  for (const call of events) {
    if (call.type !== 'tool/call' || !call.data || call.data.name !== 'ask_user_question') continue;
    const result = events.find((event) => event.type === 'tool/result' && event.data && event.data.message
      && String(event.data.message.toolCallId) === String(call.data.callId));
    if (!result) continue;
    const waitMs = result.time - call.time;
    if (!best || waitMs > best.waitMs) {
      let turnStart = null;
      for (const event of events) { if (event.seq > call.seq) break; if (event.type === 'turn/start') turnStart = event; }
      best = { start: Math.max(turnStart ? turnStart.seq : 0, call.seq - 10), end: result.seq + 12, waitMs };
    }
  }
  return best;
}, (found, best) => found.waitMs > best.waitMs);
if (question) {
  const file = path.join(OUT_DIR, 'real-question-wait-window.jsonl');
  const { lines, provenance: meta } = extractWindow(question.session.file, [[question.start, question.end]], { baseOffset: 3600000, purpose: '真实提问等待窗口' });
  writeFixture(file, lines);
  record('real-question-wait', file, { ...meta, sourceSessionIdSha8: sha8(question.session.header.id), waitMs: question.waitMs });
}

// 3) 真实 LLM 重试窗口（error-adjacent 事件，最终 turn 仍完成）
const retry = findRealWindow(({ events }) => {
  const indexes = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'assistant/attempt' || event.type === 'llm/retry' || event.type === 'llm/retry-started');
  if (indexes.length < 2) return null;
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  let turnStart = null;
  let turnEnd = null;
  for (const event of events) {
    if (event.seq <= first.event.seq && event.type === 'turn/start') turnStart = event;
    if (event.seq >= last.event.seq && event.type === 'turn/end') { turnEnd = event; break; }
  }
  if (!turnEnd) return null;
  return { start: Math.max(turnStart ? turnStart.seq : 0, first.event.seq - 8), end: Math.min(turnEnd.seq, last.event.seq + 20), retries: indexes.length };
}, (found, best) => found.end > best.end);
if (retry) {
  const file = path.join(OUT_DIR, 'real-llm-retry-window.jsonl');
  const { lines, provenance: meta } = extractWindow(retry.session.file, [[retry.start, retry.end]], { baseOffset: 7200000, purpose: '真实 LLM 重试窗口（turn 最终完成）' });
  writeFixture(file, lines);
  record('real-llm-retry', file, { ...meta, sourceSessionIdSha8: sha8(retry.session.header.id), retryEvents: retry.retries });
}

// ---------- 合成样本（源码依据） ----------
const HEADER = (id, createdAt) => ({
  type: 'session', version: 4, id, createdAt, cwd: '<workspace>', isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
});
const event = (seq, time, type, data) => ({ type, seq, time, data });

function syntheticFailed() {
  const id = 'session-00000000-0000-4000-8000-0000000000f1';
  const t0 = Date.UTC(2026, 1, 10, 0, 0, 0);
  const failure = { message: 'synthetic provider failure', code: 'PROVIDER_ERROR' };
  const events = [
    event(0, t0, 'turn/start', { turn: 1 }),
    event(1, t0 + 10, 'step/start', { turn: 1, step: 1 }),
    event(2, t0 + 20, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: t0 + 20, chunk: { type: 'finish', reason: { kind: 'error', failure } } }] }),
    event(3, t0 + 30, 'llm/retry', { retryId: 'retry-syn-1', turn: 1, step: 1, provider: 'deepseek-official', mode: 'normal', policyKey: 'synthetic', retry: 1, maxRetries: 3, delayMs: 1000, failure }),
    event(4, t0 + 1040, 'llm/retry-started', { retryId: 'retry-syn-1', turn: 1, step: 1, retry: 1 }),
    event(5, t0 + 1100, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: t0 + 1100, chunk: { type: 'finish', reason: { kind: 'error', failure } } }] }),
    event(6, t0 + 1200, 'turn/end', { turn: 1, reason: { kind: 'error', error: failure } }),
  ];
  return { name: 'synthetic-failed-turn.jsonl', header: HEADER(id, t0 - 1000), events, note: 'DSH 源码：turn/end reason={kind:"error",error:{message,code}}（dsh-agent-loop/lib/index.js:1014 附近）' };
}

function syntheticApprovalOutcomes() {
  const id = 'session-00000000-0000-4000-8000-0000000000a1';
  const t0 = Date.UTC(2026, 1, 10, 1, 0, 0);
  const ev = [];
  let seq = 0;
  const push = (time, type, data) => ev.push(event(seq++, time, type, data));
  const toolResult = (turn, callId, isError) => push(t0 + 200 * turn, 'tool/result', {
    turn, step: 1,
    message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: '<synthetic redacted>' }], isError, id: 'msg-syn-' + turn },
  });
  // turn 1: rejected
  push(t0, 'turn/start', { turn: 1 });
  push(t0 + 10, 'step/start', { turn: 1, step: 1 });
  push(t0 + 20, 'tool/call', { turn: 1, step: 1, callId: 'call_syn_a1', name: 'ops_bash', arguments: '{"command":"<synthetic redacted>"}' });
  push(t0 + 30, 'approval/asked', { id: 'appr-syn-1', toolName: 'ops_bash', callId: 'call_syn_a1', reason: 'synthetic approval rejected' });
  push(t0 + 120, 'approval/decided', { id: 'appr-syn-1', outcome: 'rejected' });
  toolResult(1, 'call_syn_a1', true);
  push(t0 + 230, 'step/end', { turn: 1, step: 1 });
  push(t0 + 240, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  // turn 2: cancelled
  push(t0 + 300, 'turn/start', { turn: 2 });
  push(t0 + 310, 'step/start', { turn: 2, step: 1 });
  push(t0 + 320, 'tool/call', { turn: 2, step: 1, callId: 'call_syn_a2', name: 'ops_bash', arguments: '{"command":"<synthetic redacted>"}' });
  push(t0 + 330, 'approval/asked', { id: 'appr-syn-2', toolName: 'ops_bash', callId: 'call_syn_a2', reason: 'synthetic approval cancelled' });
  push(t0 + 430, 'approval/decided', { id: 'appr-syn-2', outcome: 'cancelled' });
  push(t0 + 440, 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } });
  // turn 3: unavailable
  push(t0 + 600, 'turn/start', { turn: 3 });
  push(t0 + 610, 'step/start', { turn: 3, step: 1 });
  push(t0 + 620, 'tool/call', { turn: 3, step: 1, callId: 'call_syn_a3', name: 'ops_bash', arguments: '{"command":"<synthetic redacted>"}' });
  push(t0 + 630, 'approval/asked', { id: 'appr-syn-3', toolName: 'ops_bash', callId: 'call_syn_a3', reason: 'synthetic approval unavailable' });
  push(t0 + 730, 'approval/decided', { id: 'appr-syn-3', outcome: 'unavailable' });
  toolResult(3, 'call_syn_a3', true);
  push(t0 + 830, 'step/end', { turn: 3, step: 1 });
  push(t0 + 840, 'turn/end', { turn: 3, reason: { kind: 'completed' } });
  return { name: 'synthetic-approval-outcomes.jsonl', header: HEADER(id, t0 - 1000), events: ev, note: 'DSH 源码：approval outcome ∈ {allowed-once,rejected,cancelled,unavailable}（dsh-user-approval/lib/types/index.js:15）' };
}

function syntheticQuestionAborted() {
  const id = 'session-00000000-0000-4000-8000-0000000000c1';
  const t0 = Date.UTC(2026, 1, 10, 2, 0, 0);
  const events = [
    event(0, t0, 'turn/start', { turn: 1 }),
    event(1, t0 + 10, 'step/start', { turn: 1, step: 1 }),
    event(2, t0 + 20, 'tool/call', { turn: 1, step: 1, callId: 'call_syn_q1', name: 'ask_user_question', arguments: '{"questions":[{"id":"q1","question":"<synthetic>"}]}' }),
    event(3, t0 + 60000, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
  ];
  return { name: 'synthetic-question-aborted.jsonl', header: HEADER(id, t0 - 1000), events, note: '等待提问期间被取消：tool/call 无 tool/result，随后 turn/end aborted（等待必须被清理）' };
}

function writeSample(sample) {
  const file = path.join(OUT_DIR, sample.name);
  const lines = [JSON.stringify(sample.header)].concat(sample.events.map((item) => JSON.stringify(item)));
  writeFixture(file, lines);
  record(sample.kind || 'synthetic', file, {
    note: sample.note,
    eventCount: sample.events.length,
    synthetic: sample.synthetic !== undefined ? sample.synthetic : true,
    external: sample.external === true,
    source: sample.source,
  });
}

// ---------- 外部实测样本（网上找到的真实 failed 终态形状） ----------
// 依据：
//  - mimi-remote（第三方 DSH iOS 客户端）commit c552683 / issue #861：其 live-capture 契约夹具
//    contracts/harness-native/fixtures/stream/durable-events.json（capturedAt 2026-09-18，DSH 0.1.5-rc.2）
//    的 turnEndReasonsObserved 含 {"kind":"error","error":{"message":"<str:55>","code":"UNKNOWN"}}；commit
//    说明另有一次实测 error 为 MISSING_CREDENTIAL（message "No credential configured for this route."）。
//  - dsh-unstuck（MIT）：生产插件按 {kind:'error', error:{code,message}}、{kind:'aborted', reason:{kind}}、
//    max-tokens / interrupted / blocked / forked 处理异常终态；其测试覆盖同款字段形状。
// 只引用公开事实，不复制第三方文件；mimi-remote 许可为 NOASSERTION，故本文本仓库样本为自建。
function externalObservedFailed() {
  const id = 'session-00000000-0000-4000-8000-0000000000e1';
  const t0 = Date.UTC(2026, 1, 12, 0, 0, 0);
  const events = [
    // turn 1：工具回合 error（live-capture 观测：code UNKNOWN，message 长度 55 但内容脱敏）
    event(0, t0, 'turn/start', { turn: 1 }),
    event(1, t0 + 10, 'step/start', { turn: 1, step: 1 }),
    event(2, t0 + 20, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '<external-observed redacted>' }, { type: 'tool-call', name: 'ops_bash', arguments: '{}' }], id: 'msg-ext-1' } }),
    event(3, t0 + 30, 'tool/call', { turn: 1, step: 1, callId: 'call_ext_1', name: 'ops_bash', arguments: '{"command":"<redacted>"}' }),
    event(4, t0 + 40, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'call_ext_1' }, toolCallId: 'call_ext_1', content: [{ type: 'text', text: '<redacted>' }], isError: false, id: 'msg-ext-2' } }),
    event(5, t0 + 50, 'step/end', { turn: 1, step: 1 }),
    event(6, t0 + 60, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: '<redacted:55 chars>', code: 'UNKNOWN' } } }),
    // turn 2：实测 code 只在 error 里（没有 message）——失败卡片必须退回 code
    event(7, t0 + 120, 'turn/start', { turn: 2 }),
    event(8, t0 + 130, 'step/start', { turn: 2, step: 1 }),
    event(9, t0 + 140, 'turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL' } } }),
  ];
  return {
    kind: 'external-observed',
    name: 'external-observed-failed-turn.jsonl',
    header: HEADER(id, t0 - 1000),
    events,
    synthetic: true,
    external: true,
    source: 'mimi-remote (third-party live-capture fixture, NOASSERTION; facts cited only) + dsh-unstuck (MIT)',
    note: '外部实测 failed 终态：mimi-remote live-capture（2026-09-18, DSH 0.1.5-rc.2）turnEndReasonsObserved 含 kind=error/error.code=UNKNOWN；commit 说明实测 MISSING_CREDENTIAL；dsh-unstuck 生产插件同款字段。样本自建，不复制第三方文件。',
  };
}

function externalReasonKinds() {
  const id = 'session-00000000-0000-4000-8000-0000000000e2';
  const t0 = Date.UTC(2026, 1, 12, 1, 0, 0);
  const kinds = ['max-tokens', 'blocked', 'interrupted', 'forked'];
  const events = [];
  let seq = 0;
  kinds.forEach((kind, index) => {
    const turn = index + 1;
    events.push(event(seq++, t0 + turn * 1000, 'turn/start', { turn }));
    events.push(event(seq++, t0 + turn * 1000 + 10, 'step/start', { turn, step: 1 }));
    events.push(event(seq++, t0 + turn * 1000 + 20, 'turn/end', { turn, reason: { kind } }));
  });
  return {
    kind: 'external-reason-kinds',
    name: 'external-reason-kinds.jsonl',
    header: HEADER(id, t0 - 1000),
    events,
    synthetic: true,
    external: true,
    source: 'DSH 0.2.1-alpha.1 source enums (mimi-remote #861) + dsh-unstuck ABNORMAL_KINDS (MIT)',
    note: '源码 reason 枚举（max-tokens/blocked/interrupted/forked）映射验证：第三方客户端收口表（mimi-remote #861）与 dsh-unstuck 判定一致；样本自建。',
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
if (multiApproval) { /* 已写入 */ } else { consoleLines.push('real-multi-approval: 未找到同 turn 多审批窗口（跳过）'); }
if (!question) consoleLines.push('real-question-wait: 未找到（跳过）');
if (!retry) consoleLines.push('real-llm-retry: 未找到（跳过）');
writeSample(syntheticFailed());
writeSample(syntheticApprovalOutcomes());
writeSample(syntheticQuestionAborted());
writeSample(externalObservedFailed());
writeSample(externalReasonKinds());

fs.writeFileSync(path.join(OUT_DIR, 'provenance.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: '真实窗口来自本机会话日志（已脱敏）；synthetic 样本按 DSH 源码事件形状构造，仅用于 M1 状态机/契约回归。',
  samples: provenance,
}, null, 1));
console.log(consoleLines.join('\n'));
console.log('provenance → fixtures/special/provenance.json');

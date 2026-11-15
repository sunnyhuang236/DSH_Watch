// 只读样本普查：统计真实会话中与「失败终态 / 审批 / 提问 / LLM 重试」相关的样本覆盖度。
// 输出 docs/evidence/sample-census.json（路径与内容脱敏；只保留结构、枚举、seq 窗口）。
// 用法: node tools/census-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'sessions');
const OUT = path.join(REPO, 'docs', 'evidence', 'sample-census.json');
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

const census = {
  generatedAt: new Date().toISOString(),
  sessions: 0,
  mainSessions: 0,
  subagentSessions: 0,
  turnEndReasons: {},
  approval: { events: 0, decided: 0, outcomes: {}, waitsMs: [], sessions: [] },
  question: { toolCalls: 0, waitsMs: [], sessions: [], questionReplies: 0 },
  llmRetry: { assistantAttempt: 0, retry: 0, retryStarted: 0, windows: [] },
  interruptedAssistant: 0,
  toolErrorResults: 0,
  failedTurns: 0,
};

for (const file of walk(ROOT).sort()) {
  let records;
  try {
    records = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch { continue; }
  if (!records.length || !records[0] || records[0].type !== 'session') continue;
  const header = records[0];
  const events = records.slice(1);
  census.sessions += 1;
  if (header.delegationDepth > 0) census.subagentSessions += 1; else census.mainSessions += 1;
  const sid = sha8(header.id);
  const asked = new Map();
  const askedWindows = [];
  for (const event of events) {
    const data = event.data || {};
    switch (event.type) {
      case 'turn/end': {
        const kind = (data.reason && data.reason.kind) || 'unknown';
        census.turnEndReasons[kind] = (census.turnEndReasons[kind] || 0) + 1;
        if (kind === 'error') census.failedTurns += 1;
        break;
      }
      case 'approval/asked': {
        census.approval.events += 1;
        asked.set(String(data.id), { seq: event.seq, time: event.time, toolName: data.toolName });
        askedWindows.push(event.seq);
        break;
      }
      case 'approval/decided': {
        census.approval.decided += 1;
        const outcome = String(data.outcome || 'unknown');
        census.approval.outcomes[outcome] = (census.approval.outcomes[outcome] || 0) + 1;
        const ask = asked.get(String(data.id));
        if (ask) census.approval.waitsMs.push(event.time - ask.time);
        break;
      }
      case 'tool/call': {
        if (data.name === 'ask_user_question') {
          census.question.toolCalls += 1;
          const result = events.find((candidate) => candidate.type === 'tool/result'
            && candidate.data && candidate.data.message
            && String(candidate.data.message.toolCallId) === String(data.callId));
          census.question.sessions.push({ session: sid, callSeq: event.seq, resultSeq: result ? result.seq : null, waitMs: result ? result.time - event.time : null });
          if (result) census.question.waitsMs.push(result.time - event.time);
        }
        break;
      }
      case 'user/message':
        if (data.source && data.source.kind === 'user-question-reply') census.question.questionReplies += 1;
        break;
      case 'assistant/message':
        if (data.interrupted === true) census.interruptedAssistant += 1;
        break;
      case 'tool/result':
        if (data.message && data.message.isError) census.toolErrorResults += 1;
        break;
      case 'assistant/attempt':
        census.llmRetry.assistantAttempt += 1;
        census.llmRetry.windows.push({ session: sid, seq: event.seq, kind: 'assistant/attempt' });
        break;
      case 'llm/retry':
        census.llmRetry.retry += 1;
        census.llmRetry.windows.push({ session: sid, seq: event.seq, kind: 'llm/retry' });
        break;
      case 'llm/retry-started':
        census.llmRetry.retryStarted += 1;
        break;
      default:
        break;
    }
  }
  if (askedWindows.length) {
    census.approval.sessions.push({ session: sid, depth: header.delegationDepth, asked: askedWindows.length, firstSeq: Math.min(...askedWindows), lastSeq: Math.max(...askedWindows) });
  }
}
census.approval.waitsMs.sort((a, b) => a - b);
const stat = (array) => array.length ? { n: array.length, min: array[0], p50: array[Math.floor(array.length / 2)], max: array[array.length - 1] } : { n: 0 };
census.approval.waitStats = stat(census.approval.waitsMs);
census.question.waitStats = stat(census.question.waitsMs);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(census, null, 1));

console.log('样本普查 ' + census.generatedAt + ' → ' + OUT);
console.log('sessions=' + census.sessions + '（main=' + census.mainSessions + ' subagent=' + census.subagentSessions + '）');
console.log('turnEndReasons=' + JSON.stringify(census.turnEndReasons) + ' failedTurns=' + census.failedTurns);
console.log('approval: asked=' + census.approval.events + ' decided=' + census.approval.decided + ' outcomes=' + JSON.stringify(census.approval.outcomes) + ' wait=' + JSON.stringify(census.approval.waitStats));
console.log('  sessionsWithApprovals=' + census.approval.sessions.length + ' ' + JSON.stringify(census.approval.sessions));
console.log('question: toolCalls=' + census.question.toolCalls + ' waits=' + JSON.stringify(census.question.waitStats) + ' user-question-reply=' + census.question.questionReplies);
console.log('llmRetry: attempt=' + census.llmRetry.assistantAttempt + ' retry=' + census.llmRetry.retry + ' windows=' + JSON.stringify(census.llmRetry.windows.slice(0, 10)));
console.log('interruptedAssistant=' + census.interruptedAssistant + ' toolErrorResults=' + census.toolErrorResults);

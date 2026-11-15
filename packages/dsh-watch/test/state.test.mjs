// 状态机单元测试：覆盖 M0 结论中的关键规则与反例。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchStore } from '../lib/core/store.mjs';
import { Ingestor } from '../lib/core/pipeline.mjs';
import { sessionMeta } from '../lib/core/normalize.mjs';
import { makeHeader, dsh } from './helpers.mjs';

function replay(events, headerOverrides = {}) {
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  const header = makeHeader(headerOverrides);
  const meta = sessionMeta(header);
  const snapshots = [];
  for (const event of events) {
    ingestor.ingest(meta, event);
    snapshots.push(store.getTask(meta.task_id));
  }
  return { store, ingestor, meta, snapshots, final: store.getTask(meta.task_id) };
}

const TURN_START = dsh(0, 1000, 'turn/start', { turn: 1 });
const STEP_START = dsh(1, 1010, 'step/start', { turn: 1, step: 1 });

test('completed → succeeded，run_id/ended_at/token 正确', () => {
  const { final } = replay([
    TURN_START, STEP_START,
    dsh(2, 1020, 'tool/call', { turn: 1, step: 1, callId: 'call_1', name: 'ops_bash', arguments: '{}' }),
    dsh(3, 1050, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call_1', source: { kind: 'tool', callId: 'call_1' }, content: [{ type: 'text', text: 'ok' }], isError: false, id: 'm1' } }),
    dsh(4, 1060, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], id: 'm2' }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1, cacheWriteTokens: 0, totalTokens: 15 } }),
    dsh(5, 1070, 'step/end', { turn: 1, step: 1 }),
    dsh(6, 1080, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]);
  assert.equal(final.state, 'succeeded');
  assert.equal(final.run_id, 'session-test-0001:1');
  assert.equal(final.state_version, 2);
  assert.equal(final.ended_at, 1080);
  assert.equal(final.summary, '已完成');
  assert.deepEqual(final.token_usage, {
    input_tokens: 10, output_tokens: 5, cache_read_tokens: 1,
    cache_write_tokens: 0, total_tokens: 15, messages: 1,
  });
});

test('aborted → cancelled（含 reason.reason.kind=user）', () => {
  const { final } = replay([
    TURN_START,
    dsh(1, 1020, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
  ]);
  assert.equal(final.state, 'cancelled');
  assert.equal(final.summary, '已取消');
});

test('未知 reason.kind → unknown（不得当成 succeeded）', () => {
  const { final } = replay([
    TURN_START,
    dsh(1, 1020, 'turn/end', { turn: 1, reason: { kind: 'timeout' } }),
  ]);
  assert.equal(final.state, 'unknown');
  assert.match(final.summary, /未知终态/);
  assert.equal(final.ended_at, null);
});

test('工具报错不改变终态（tool/result.isError=true + completed → succeeded）', () => {
  const { final } = replay([
    TURN_START, STEP_START,
    dsh(2, 1020, 'tool/call', { turn: 1, step: 1, callId: 'call_e', name: 'ops_bash', arguments: '{}' }),
    dsh(3, 1030, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call_e', source: { kind: 'tool', callId: 'call_e' }, content: [{ type: 'text', text: 'boom' }], isError: true, id: 'm3' } }),
    dsh(4, 1035, 'step/end', { turn: 1, step: 1 }),
    dsh(5, 1040, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]);
  assert.equal(final.state, 'succeeded');
});

test('审批：approval/asked → waiting_approval，decided 后恢复 running', () => {
  const { snapshots, final } = replay([
    TURN_START, STEP_START,
    dsh(2, 1020, 'tool/call', { turn: 1, step: 1, callId: 'call_a', name: 'ops_bash', arguments: '{}' }),
    dsh(3, 1030, 'approval/asked', { id: 'appr-1', toolName: 'ops_bash', callId: 'call_a', reason: '需要批准' }),
    dsh(4, 1200, 'approval/decided', { id: 'appr-1', outcome: 'allowed-once' }),
    dsh(5, 1210, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call_a', source: { kind: 'tool', callId: 'call_a' }, content: [], isError: false, id: 'm4' } }),
    dsh(6, 1215, 'step/end', { turn: 1, step: 1 }),
    dsh(7, 1300, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]);
  const waiting = snapshots.find((snapshot) => snapshot && snapshot.state === 'waiting_approval');
  assert.ok(waiting, '应观测到 waiting_approval');
  assert.equal(waiting.waiting.kind, 'approval');
  assert.equal(waiting.waiting.tool_name, 'ops_bash');
  assert.equal(final.state, 'succeeded');
  assert.equal(final.waiting, null);
});

test('提问：ask_user_question 的 call 未返回时 waiting_input，返回后 running', () => {
  const { snapshots, final } = replay([
    TURN_START, STEP_START,
    dsh(2, 1020, 'tool/call', { turn: 1, step: 1, callId: 'call_q', name: 'ask_user_question', arguments: '{}' }),
    dsh(3, 5000, 'tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'call_q', source: { kind: 'tool', callId: 'call_q' }, content: [], isError: false, id: 'm5' } }),
  ]);
  const waiting = snapshots.find((snapshot) => snapshot && snapshot.state === 'waiting_input');
  assert.ok(waiting, '应观测到 waiting_input');
  assert.equal(waiting.waiting.call_id, 'call_q');
  assert.equal(final.state, 'running');
  assert.equal(final.waiting, null);
});

test('终态按 run 不可逆：completed 之后迟到事件不改状态', () => {
  const { snapshots, final } = replay([
    TURN_START,
    dsh(1, 1020, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    dsh(2, 1030, 'step/start', { turn: 1, step: 2 }),
    dsh(3, 1040, 'tool/call', { turn: 1, step: 2, callId: 'call_late', name: 'ops_bash', arguments: '{}' }),
  ]);
  assert.equal(final.state, 'succeeded');
  assert.equal(final.state_version, 2);
  assert.equal(snapshots[1].state, 'succeeded');
});

test('新 turn 开启新 run：终态后可恢复 running', () => {
  const { final } = replay([
    TURN_START,
    dsh(1, 1020, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    dsh(2, 2000, 'turn/start', { turn: 2 }),
    dsh(3, 2010, 'step/start', { turn: 2, step: 1 }),
  ]);
  assert.equal(final.state, 'running');
  assert.equal(final.run_id, 'session-test-0001:2');
  assert.equal(final.state_version, 3); // running → succeeded → running
});

test('事件幂等：重复 event_id 不重复插入/不重复累计', () => {
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  const meta = sessionMeta(makeHeader());
  const first = ingestor.ingest(meta, TURN_START);
  const second = ingestor.ingest(meta, TURN_START);
  assert.equal(first.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(store.stats().events, 1);
  assert.equal(store.getTask(meta.task_id).state_version, 1);
  store.close();
});

test('标题：优先 session/title；否则首个真人 user/message', () => {
  const human = replay([
    TURN_START,
    dsh(1, 1010, 'user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我检查登录流程' }], source: { kind: 'user' } }),
  ]);
  assert.equal(human.final.title, '帮我检查登录流程');
  const injected = replay([
    TURN_START,
    dsh(1, 1010, 'user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: 'skill catalog' }], source: { kind: 'skill-catalog' } }),
  ]);
  assert.equal(injected.final.title, 'workspace');
  const titled = replay([
    TURN_START,
    dsh(1, 1010, 'session/title', { title: '登录流程排查', source: { kind: 'fallback' } }),
  ]);
  assert.equal(titled.final.title, '登录流程排查');
});

// fixtures 回归：真实样本 + 专项样本 → 归一化 → 状态机 → 快照。
// 断言 M0/M1 结论（终态、等待窗口、子代理深度、幂等性、无 Schema 违规）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../../contract/validate.mjs';
import { SCHEMA_VERSION } from '../lib/core/contract.mjs';
import { WatchStore } from '../lib/core/store.mjs';
import { Ingestor } from '../lib/core/pipeline.mjs';
import { sessionMeta } from '../lib/core/normalize.mjs';
import { REPO, listFixtures, loadFixture } from './helpers.mjs';

const SNAPSHOT_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'contract/schema/task-snapshot.schema.json'), 'utf8'));
const EVENT_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'contract/schema/task-event.schema.json'), 'utf8'));

const EXPECT = {
  // M0 真实会话样本
  'fixture-01-completed-with-tool-errors.jsonl': { applied: 42, ignored: 2, finalState: 'succeeded', seen: ['running', 'succeeded'], stateVersion: 2, tokenMessagesMin: 1 },
  'fixture-02-approval-wait.jsonl': { applied: 46, ignored: 1, finalState: 'succeeded', seen: ['waiting_approval', 'succeeded'], stateVersion: 4 },
  'fixture-03-aborted-turns.jsonl': { applied: 12, ignored: 2, finalState: 'cancelled', seen: ['running', 'cancelled'], stateVersion: 4 },
  'fixture-04-waiting-question-live.jsonl': { applied: 17, ignored: 0, finalState: 'running', seen: ['waiting_input', 'running'], stateVersion: 3 },
  'fixture-05-subagent-session.jsonl': { applied: 64, ignored: 4, finalState: 'succeeded', seen: ['running', 'succeeded'], stateVersion: 2, delegationDepth: 1 },
  // M1 专项样本（真实窗口）
  'special/real-multi-approval-window.jsonl': { finalState: 'running', seen: ['waiting_approval'], minApprovals: 2, synthetic: false },
  'special/real-question-wait-window.jsonl': { finalState: 'running', seen: ['waiting_input'], minQuestions: 1, synthetic: false },
  'special/real-llm-retry-window.jsonl': { finalState: 'running', seen: ['running'], minRetries: 2, synthetic: false },
  // M1 专项样本（合成，按 DSH 源码形状构造）
  'special/synthetic-failed-turn.jsonl': { finalState: 'failed', seen: ['running', 'failed'], synthetic: true, expectErrorCode: true },
  'special/synthetic-approval-outcomes.jsonl': { finalState: 'succeeded', seen: ['waiting_approval'], synthetic: true, expectedOutcomes: ['rejected', 'cancelled', 'unavailable'] },
  'special/synthetic-question-aborted.jsonl': { finalState: 'cancelled', seen: ['waiting_input', 'cancelled'], synthetic: true },
  // M1 外部实测样本（网上找到的第三方真实 failed 终态形状 + 源码 reason 枚举）
  'special/external-observed-failed-turn.jsonl': { finalState: 'failed', seen: ['running', 'failed'], synthetic: true },
  'special/external-reason-kinds.jsonl': { finalState: 'cancelled', seen: ['failed', 'cancelled'], synthetic: true },
};

for (const name of listFixtures()) {
  test('fixtures: ' + name, () => {
    const expected = EXPECT[name];
    assert.ok(expected, '未登记该 fixture 的预期（新增样本需同步更新测试）');
    const { header, events } = loadFixture(name);
    const meta = sessionMeta(header);
    const store = new WatchStore();
    const ingestor = new Ingestor({ store });
    const seen = new Set();
    for (const event of events) {
      ingestor.ingest(meta, event);
      const snapshot = store.getTask(meta.task_id);
      if (snapshot) seen.add(snapshot.state);
    }
    const snapshot = store.getTask(meta.task_id);
    assert.ok(snapshot, '应生成任务快照');
    assert.equal(snapshot.state, expected.finalState);
    assert.equal(ingestor.stats.errors, 0);
    for (const state of expected.seen) assert.ok(seen.has(state), '应观测到状态 ' + state);
    if (expected.applied !== undefined) assert.equal(ingestor.stats.ingested, expected.applied);
    if (expected.ignored !== undefined) assert.equal(ingestor.stats.ignored, expected.ignored);
    if (expected.stateVersion !== undefined) assert.equal(snapshot.state_version, expected.stateVersion);
    if (expected.tokenMessagesMin !== undefined) {
      assert.ok(snapshot.token_usage && snapshot.token_usage.messages >= expected.tokenMessagesMin, 'token_usage 应有累计');
    }
    if (expected.delegationDepth !== undefined) assert.equal(snapshot.delegation_depth, expected.delegationDepth);
    if (expected.minApprovals !== undefined) {
      assert.ok(events.filter((event) => event.type === 'approval/asked').length >= expected.minApprovals);
    }
    if (expected.minQuestions !== undefined) {
      assert.ok(events.filter((event) => event.type === 'tool/call' && event.data && event.data.name === 'ask_user_question').length >= expected.minQuestions);
    }
    if (expected.minRetries !== undefined) {
      assert.ok(events.filter((event) => event.type === 'llm/retry').length >= expected.minRetries);
    }
    if (expected.expectedOutcomes) {
      const outcomes = events.filter((event) => event.type === 'approval/decided').map((event) => event.data.outcome).sort();
      assert.deepEqual(outcomes, expected.expectedOutcomes.slice().sort());
    }
    assert.equal(snapshot.waiting, null);
    assert.deepEqual(validate(SNAPSHOT_SCHEMA, snapshot), [], 'snapshot schema violations');
    const storedEvents = store.listEvents(meta.task_id, { afterSeq: -1, limit: 1000 });
    assert.ok(storedEvents.length > 0);
    for (const event of storedEvents) {
      assert.deepEqual(validate(EVENT_SCHEMA, { schema_version: SCHEMA_VERSION, ...event }), []);
    }
    // 幂等：同一份日志再灌一遍，不新增事件、快照不变。
    const beforeJson = JSON.stringify(snapshot);
    const beforeStats = store.stats();
    const appliedAgain = ingestor.ingestSessionEvents(meta, events);
    assert.equal(appliedAgain, 0, '重复回放不应新增事件');
    assert.equal(JSON.stringify(store.getTask(meta.task_id)), beforeJson, '重复回放不应改变快照');
    assert.deepEqual(store.stats(), beforeStats);
    store.close();
  });
}

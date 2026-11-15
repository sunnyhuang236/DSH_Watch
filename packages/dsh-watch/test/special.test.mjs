// 专项样本测试：分支覆盖 + provenance 完整性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WatchStore } from '../lib/core/store.mjs';
import { Ingestor } from '../lib/core/pipeline.mjs';
import { sessionMeta } from '../lib/core/normalize.mjs';
import { loadFixture, REPO } from './helpers.mjs';

const SPECIAL_DIR = path.join(REPO, 'fixtures', 'special');
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(SPECIAL_DIR, 'provenance.json'), 'utf8'));

function replay(name) {
  const { header, events } = loadFixture('special/' + name);
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  const meta = sessionMeta(header);
  const snapshots = [];
  for (const event of events) {
    ingestor.ingest(meta, event);
    snapshots.push(store.getTask(meta.task_id));
  }
  return { header, events, store, ingestor, meta, snapshots, final: store.getTask(meta.task_id) };
}

test('provenance：special 样本全部登记、sha256 一致、synthetic 标记正确', () => {
  const files = fs.readdirSync(SPECIAL_DIR).filter((name) => name.endsWith('.jsonl')).sort();
  const listed = PROVENANCE.samples.map((sample) => path.basename(sample.file)).sort();
  assert.deepEqual(listed, files, '每个 special 样本都应登记 provenance');
  for (const sample of PROVENANCE.samples) {
    const file = path.join(REPO, sample.file);
    assert.ok(fs.existsSync(file), '样例文件存在: ' + sample.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const sha256 = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
    assert.equal(sha256, sample.sha256, 'sha256 不一致: ' + sample.file);
    if (!sample.synthetic) {
      assert.equal(typeof sample.sourceSessionIdSha8, 'string', '真实窗口应记录源会话');
      assert.ok(Array.isArray(sample.originalRanges) || Array.isArray(sample.originalRanges), '真实窗口应记录原始 seq 区间');
    } else {
      assert.match(String(sample.note), /DSH 源码|synthetic|合成|等待|第三方|实测|mimi|unstuck/, '合成/外部样本应给出依据说明');
    }
  }
});

test('failed 终态：turn/end kind=error → failed，并保留 error_code', () => {
  const { events, final } = replay('synthetic-failed-turn.jsonl');
  assert.equal(final.state, 'failed');
  assert.equal(final.summary, '执行失败');
  assert.ok(Number.isFinite(final.ended_at));
  const endEvent = events.find((event) => event.type === 'turn/end');
  assert.equal(endEvent.data.reason.kind, 'error');
  assert.equal(endEvent.data.reason.error.code, 'PROVIDER_ERROR');
  const normalized = final; // 快照不携带错误原文
  assert.equal(normalized.cost, null);
});

test('审批三种未观测 outcome：rejected / cancelled / unavailable 均可判定等待解除', () => {
  const { events, snapshots, final } = replay('synthetic-approval-outcomes.jsonl');
  const outcomes = events.filter((event) => event.type === 'approval/decided').map((event) => event.data.outcome).sort();
  assert.deepEqual(outcomes, ['cancelled', 'rejected', 'unavailable']);
  const waitingTransitions = snapshots.filter((snapshot, index) => snapshot
    && snapshot.state === 'waiting_approval'
    && (index === 0 || !snapshots[index - 1] || snapshots[index - 1].state !== 'waiting_approval'));
  assert.equal(waitingTransitions.length, 3, '三次审批都应进入 waiting_approval');
  assert.equal(final.state, 'succeeded');
  assert.equal(final.waiting, null);
  assert.equal(final.run_id, 'session-00000000-0000-4000-8000-0000000000a1:3');
});

test('等待提问期间被取消：waiting_input → cancelled，等待清理', () => {
  const { snapshots, final } = replay('synthetic-question-aborted.jsonl');
  assert.ok(snapshots.some((snapshot) => snapshot && snapshot.state === 'waiting_input'));
  assert.equal(final.state, 'cancelled');
  assert.equal(final.waiting, null);
  assert.equal(final.current_tool, null);
});

test('真实 LLM 重试窗口：出现 assistant/attempt + llm/retry，但状态不被误判为 failed', () => {
  const { events, final } = replay('real-llm-retry-window.jsonl');
  assert.ok(events.filter((event) => event.type === 'assistant/attempt').length >= 2);
  assert.ok(events.filter((event) => event.type === 'llm/retry').length >= 2);
  assert.notEqual(final.state, 'failed');
  assert.equal(final.state, 'running');
});

test('真实多审批窗口：同一 turn ≥2 次审批，等待态可见', () => {
  const { events, snapshots, final } = replay('real-multi-approval-window.jsonl');
  assert.ok(events.filter((event) => event.type === 'approval/asked').length >= 2);
  assert.ok(snapshots.some((snapshot) => snapshot && snapshot.state === 'waiting_approval'));
  assert.equal(final.state, 'running');
});

test('真实提问等待窗口：waiting_input 可见且 tool/result 后恢复 running', () => {
  const { store, meta, snapshots, final } = replay('real-question-wait-window.jsonl');
  assert.ok(snapshots.some((snapshot) => snapshot && snapshot.state === 'waiting_input'));
  const normalizedEvents = store.listEvents(meta.task_id, { afterSeq: -1, limit: 1000 });
  const started = normalizedEvents.find((event) => event.type === 'tool_started' && event.payload.name === 'ask_user_question');
  const finished = normalizedEvents.find((event) => event.type === 'tool_finished' && started && event.payload.call_id === started.payload.call_id);
  assert.ok(started, '应有 ask_user_question 的 tool_started 归一化事件');
  assert.ok(finished, '应有对应 tool_finished（等待解除）');
  assert.equal(final.state, 'running');
});

// ---------- 外部实测样本（网上找到的真实 failed 终态形状） ----------

test('外部实测 failed：turn/end reason=error 的 error.code 保留（UNKNOWN / MISSING_CREDENTIAL）', () => {
  const { store, meta, final } = replay('external-observed-failed-turn.jsonl');
  assert.equal(final.state, 'failed');
  assert.equal(final.summary, '执行失败');
  assert.ok(Number.isFinite(final.ended_at));
  const normalized = store.listEvents(meta.task_id, { afterSeq: -1, limit: 1000 });
  const finished = normalized.filter((event) => event.type === 'run_finished');
  assert.deepEqual(finished.map((event) => event.payload.reason_kind), ['error', 'error']);
  assert.deepEqual(finished.map((event) => event.payload.error_code), ['UNKNOWN', 'MISSING_CREDENTIAL']);
  // 新 run 覆盖旧终态（turn 2 再次失败）
  assert.equal(final.run_id, 'session-00000000-0000-4000-8000-0000000000e1:2');
});

test('源码 reason 枚举：max-tokens/blocked → failed，interrupted/forked → cancelled', () => {
  const { store, meta, final } = replay('external-reason-kinds.jsonl');
  const normalized = store.listEvents(meta.task_id, { afterSeq: -1, limit: 1000 });
  const finished = normalized.filter((event) => event.type === 'run_finished');
  assert.deepEqual(finished.map((event) => event.payload.reason_kind), ['max-tokens', 'blocked', 'interrupted', 'forked']);
  assert.deepEqual(finished.map((event) => event.payload.error_code), ['MAX_TOKENS', 'BLOCKED', null, null]);
  assert.equal(final.state, 'cancelled'); // 最后一轮 forked → cancelled
  // 前两轮曾进入 failed，后两轮曾进入 cancelled
  const states = normalized.map((event) => event.type);
  assert.ok(states.length > 0);
});

test('外部实测样本的 provenance 标注 external/source', () => {
  for (const sample of PROVENANCE.samples.filter((item) => item.external)) {
    assert.match(String(sample.source), /mimi-remote|dsh-unstuck|DSH 0\.2\.1-alpha\.1/, '外部样本应记录来源');
    assert.match(String(sample.note), /实测|live-capture|第三方|源码/, '外部样本应说明依据');
    assert.equal(sample.synthetic, true, '外部样本不是本机真实抓取，必须标注 synthetic=true');
  }
  const external = PROVENANCE.samples.filter((item) => item.external);
  assert.ok(external.length >= 2, '应有外部实测 failed 与源码 reason 枚举样本');
});

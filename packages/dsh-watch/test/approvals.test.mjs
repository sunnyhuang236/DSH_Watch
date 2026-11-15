import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalBridge } from '../lib/core/approvals.mjs';

function fakeRequest(overrides = {}) {
  return {
    agent: { session: { id: 'session-1' } },
    toolName: 'ops_bash',
    callId: 'call-1',
    reason: 'test reason',
    displayReason: { zh: '测试原因' },
    ...overrides,
  };
}

test('ApprovalBridge：手机先决定，桌面后到不覆盖', async () => {
  const bridge = new ApprovalBridge({ ttlMs: 60_000 });
  let releaseDesktop;
  const desktop = new Promise((resolve) => { releaseDesktop = resolve; });
  const pending = bridge.handle(fakeRequest(), () => desktop);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = bridge.list({ taskId: 'session-1' })[0];
  assert.ok(action);
  assert.equal(action.status, 'pending');
  const decision = bridge.decide(action.action_id, 'allowed-once');
  assert.equal(decision.status, 'accepted');
  assert.equal(await pending, 'allowed-once');
  releaseDesktop('rejected');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bridge.get(action.action_id).status, 'decided');
  assert.equal(bridge.get(action.action_id).decision, 'mobile');
});

test('ApprovalBridge：桌面先决定，手机返回 conflict', async () => {
  const bridge = new ApprovalBridge({ ttlMs: 60_000 });
  let release;
  const desktop = new Promise((resolve) => { release = resolve; });
  const pending = bridge.handle(fakeRequest(), () => desktop);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = bridge.list({ taskId: 'session-1' })[0];
  release('rejected');
  assert.equal(await pending, 'rejected');
  const decision = bridge.decide(action.action_id, 'allowed-once');
  assert.equal(decision.status, 'conflict');
});

test('ApprovalBridge：重复/非法决定被拒绝', async () => {
  const bridge = new ApprovalBridge({ ttlMs: 60_000 });
  const pending = bridge.handle(fakeRequest(), () => new Promise(() => {}));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = bridge.list({ taskId: 'session-1' })[0];
  assert.equal(bridge.decide(action.action_id, 'bogus').status, 'bad_request');
  assert.equal(bridge.decide(action.action_id, 'rejected').status, 'accepted');
  assert.equal(bridge.decide(action.action_id, 'allowed-once').status, 'conflict');
  void pending;
});

test('ApprovalBridge：/v1/actions 列表与 decision API', async () => {
  const { startApi } = await import('../lib/api.mjs');
  const { WatchStore } = await import('../lib/core/store.mjs');
  const bridge = new ApprovalBridge({ ttlMs: 60_000 });
  const store = new WatchStore();
  const api = await startApi({ store, port: 0, approvals: bridge });
  const base = api.url;
  try {
    const pending = bridge.handle(fakeRequest(), () => new Promise(() => {}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const list = await fetch(base + 'v1/actions?task_id=session-1').then((r) => r.json());
    assert.equal(list.actions.length, 1);
    assert.equal(list.actions[0].status, 'pending');
    const actionId = list.actions[0].action_id;
    const decision = await fetch(base + 'v1/actions/' + actionId + '/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    });
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).status, 'accepted');
    assert.equal(await pending, 'rejected');
    const conflict = await fetch(base + 'v1/actions/' + actionId + '/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'allowed-once' }),
    });
    assert.equal(conflict.status, 409);
  } finally {
    await api.close();
    store.close();
  }
});

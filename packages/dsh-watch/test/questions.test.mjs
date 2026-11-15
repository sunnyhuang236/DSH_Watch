import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionBridge } from '../lib/core/questions.mjs';
import { startApi } from '../lib/api.mjs';
import { WatchStore } from '../lib/core/store.mjs';

const request = () => ({
  agent: { session: { id: 'session-q' } },
  questions: [{ id: 'q1', question: '选一个', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }],
});

test('QuestionBridge：手机回答一批问题', async () => {
  const bridge = new QuestionBridge({ ttlMs: 60_000 });
  const pending = bridge.handle(request(), () => new Promise(() => {}));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = bridge.list({ taskId: 'session-q' })[0];
  assert.equal(action.status, 'pending');
  const result = bridge.answer(action.action_id, [{ id: 'q1', selected: ['A'] }]);
  assert.equal(result.status, 'accepted');
  assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['A'] }] });
  assert.equal(bridge.get(action.action_id).decision, 'mobile');
});

test('QuestionBridge：非法/重复答案与桌面抢答', async () => {
  const bridge = new QuestionBridge({ ttlMs: 60_000 });
  let release;
  const pending = bridge.handle(request(), () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const action = bridge.list({ taskId: 'session-q' })[0];
  assert.equal(bridge.answer(action.action_id, [{ id: 'q1', selected: ['X'] }]).status, 'bad_request');
  release({ answers: [{ id: 'q1', selected: ['B'] }] });
  assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['B'] }] });
  assert.equal(bridge.answer(action.action_id, [{ id: 'q1', selected: ['A'] }]).status, 'conflict');
});

test('QuestionBridge：/v1/questions API', async () => {
  const bridge = new QuestionBridge({ ttlMs: 60_000 });
  const store = new WatchStore();
  const api = await startApi({ store, port: 0, questions: bridge });
  try {
    const pending = bridge.handle(request(), () => new Promise(() => {}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const list = await fetch(api.url + 'v1/questions?task_id=session-q').then((r) => r.json());
    assert.equal(list.questions.length, 1);
    const id = list.questions[0].action_id;
    const answer = await fetch(api.url + 'v1/questions/' + id + '/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ id: 'q1', selected: ['A'] }] }),
    });
    assert.equal(answer.status, 200);
    assert.equal((await answer.json()).status, 'accepted');
    assert.deepEqual(await pending, { answers: [{ id: 'q1', selected: ['A'] }] });
  } finally { await api.close(); store.close(); }
});

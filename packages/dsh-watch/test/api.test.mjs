// /v1 只读 API 测试：健康检查、任务列表、快照、事件、错误码、方法限制、调试面板。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchStore } from '../lib/core/store.mjs';
import { Ingestor } from '../lib/core/pipeline.mjs';
import { sessionMeta } from '../lib/core/normalize.mjs';
import { SCHEMA_VERSION } from '../lib/core/contract.mjs';
import { startApi } from '../lib/api.mjs';
import { loadFixture, getJson } from './helpers.mjs';

test('/v1 API 全链路（fixture-02）', async () => {
  const { header, events } = loadFixture('fixture-02-approval-wait.jsonl');
  const meta = sessionMeta(header);
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  ingestor.ingestSessionEvents(meta, events);
  const snapshot = store.getTask(meta.task_id);
  const taskId = encodeURIComponent(meta.task_id);
  const api = await startApi({ store, port: 0 });
  const base = api.url;
  try {
    const health = await getJson(base + 'v1/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.schema_version, SCHEMA_VERSION);
    assert.equal(health.body.stats.tasks, 1);
    assert.ok(health.body.stats.events > 0);

    const tasks = await getJson(base + 'v1/tasks');
    assert.equal(tasks.status, 200);
    assert.equal(tasks.body.schema_version, SCHEMA_VERSION);
    assert.equal(tasks.body.tasks.length, 1);
    assert.equal(tasks.body.tasks[0].task_id, meta.task_id);

    const filtered = await getJson(base + 'v1/tasks?state=succeeded');
    assert.equal(filtered.body.tasks.length, 1);
    const filteredEmpty = await getJson(base + 'v1/tasks?state=failed');
    assert.equal(filteredEmpty.body.tasks.length, 0);
    const badState = await getJson(base + 'v1/tasks?state=nope');
    assert.equal(badState.status, 400);
    assert.equal(badState.body.error.code, 'bad_request');

    const task = await getJson(base + 'v1/tasks/' + taskId);
    assert.equal(task.status, 200);
    assert.equal(task.body.task_id, meta.task_id);
    assert.equal(task.body.state, 'succeeded');
    assert.deepEqual(task.body, snapshot);

    const eventPage = await getJson(base + 'v1/tasks/' + taskId + '/events?after_seq=-1&limit=500');
    assert.equal(eventPage.status, 200);
    assert.equal(eventPage.body.task_id, meta.task_id);
    assert.equal(eventPage.body.events.length, ingestor.stats.ingested);
    assert.ok(eventPage.body.events.every((event) => typeof event.seq === 'number'));

    const notFound = await getJson(base + 'v1/tasks/' + encodeURIComponent('session-missing'));
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error.code, 'not_found');
    const eventsNotFound = await getJson(base + 'v1/tasks/' + encodeURIComponent('session-missing') + '/events');
    assert.equal(eventsNotFound.status, 404);

    const post = await fetch(base + 'v1/tasks', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal((await post.json()).error.code, 'method_not_allowed');

    const root = await fetch(base);
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /DSH Watch/);
    assert.match(html, /\/v1\/tasks/);
    assert.match(html, /\/v1\/health/);
  } finally {
    await api.close();
    store.close();
  }
});

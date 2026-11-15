import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayStore } from '../lib/store.mjs';
import { NotificationWatcher } from '../lib/notifier.mjs';
import { tempStatePath, cleanup, startFakeUpstream, task } from './helpers.mjs';

test('通知触发：首次只建基线；进入等待/终态各发一次；重复不重发', async () => {
  const { dir, file } = tempStatePath();
  const upstream = await startFakeUpstream([task({ task_id: 'session-a', state: 'running', run_id: 'session-a:1' })]);
  try {
    const store = new GatewayStore({ path: file });
    const sent = [];
    const push = { async sendToAll(payload) { sent.push(payload); return { sent: 1, failed: 0, removed: 0 }; } };
    const watcher = new NotificationWatcher({ store, push, upstream: upstream.url, intervalMs: 999999, mergeWindowMs: 0 });
    await watcher.tick(); // 基线，不发
    assert.equal(sent.length, 0);

    upstream.state.tasks[0] = task({ task_id: 'session-a', state: 'waiting_input', run_id: 'session-a:1', waiting: { kind: 'input', since: Date.now() } });
    await watcher.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'waiting_input');
    assert.equal(sent[0].task, 'session-a');
    assert.equal(sent[0].title, undefined); // payload 不含标题/摘要

    await watcher.tick();
    assert.equal(sent.length, 1, '重复状态不重发');

    upstream.state.tasks[0] = task({ task_id: 'session-a', state: 'succeeded', run_id: 'session-a:1', summary: '已完成' });
    await watcher.tick();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].kind, 'succeeded');

    // 新 run 再次完成：不同 event key → 再发一次
    upstream.state.tasks[0] = task({ task_id: 'session-a', state: 'running', run_id: 'session-a:2' });
    await watcher.tick();
    upstream.state.tasks[0] = task({ task_id: 'session-a', state: 'succeeded', run_id: 'session-a:2' });
    await watcher.tick();
    assert.equal(sent.length, 3);
    assert.equal(sent[2].kind, 'succeeded');
  } finally {
    await upstream.close();
    cleanup(dir);
  }
});

test('通知触发：离开等待会撤销尚未投递的等待提醒', async () => {
  const { dir, file } = tempStatePath();
  const upstream = await startFakeUpstream([task({ task_id: 'session-b', state: 'running', run_id: 'session-b:1' })]);
  try {
    const store = new GatewayStore({ path: file });
    const sent = [];
    const push = { async sendToAll(payload) { sent.push(payload); return { sent: 1, failed: 0, removed: 0 }; } };
    const watcher = new NotificationWatcher({ store, push, upstream: upstream.url, intervalMs: 999999, mergeWindowMs: 5000 });
    await watcher.tick();
    upstream.state.tasks[0] = task({ task_id: 'session-b', state: 'waiting_approval', run_id: 'session-b:1' });
    await watcher.tick(); // 进入等待，但 5s 合并窗口内不立即发
    assert.equal(sent.length, 0);
    assert.equal(watcher.pending.get('session-b').kind, 'waiting_approval');
    upstream.state.tasks[0] = task({ task_id: 'session-b', state: 'running', run_id: 'session-b:1' });
    await watcher.tick(); // 解除等待 → 撤销
    assert.equal(watcher.pending.has('session-b'), false);
    assert.equal(sent.length, 0);
  } finally {
    await upstream.close();
    cleanup(dir);
  }
});

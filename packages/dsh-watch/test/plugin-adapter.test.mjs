// 插件适配器测试：用假 Cordis ctx 验证 apply() 的订阅/服务/卸载行为（不依赖 DSH 运行）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, name, inject } from '../lib/index.js';
import { loadFixture, freePort, waitFor, getJson } from './helpers.mjs';

function fakeCtx(sessions = [], agents = []) {
  const handlers = new Map();
  const cleanups = [];
  return {
    logger: { info() {}, warn() {}, error() {} },
    sessions: { list() { return sessions; } },
    agents: { list() { return agents; } },
    on(event, listener) {
      handlers.set(event, listener);
      return () => handlers.delete(event);
    },
    effect(execute) {
      cleanups.push(execute());
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
    },
    handlers,
  };
}

test('插件元数据与 apply 的订阅注册', async () => {
  assert.equal(name, 'dsh-watch');
  assert.deepEqual(inject, ['sessions', 'agents']);
  const port = await freePort();
  const ctx = fakeCtx();
  apply(ctx, { port, host: '127.0.0.1', db: ':memory:' });
  try {
    for (const event of ['session/event', 'agent/status', 'agent/created', 'agent/error', 'goal/changed']) {
      assert.equal(typeof ctx.handlers.get(event), 'function', '应订阅 ' + event);
    }
  } finally {
    ctx.dispose();
  }
});

test('session/event → 快照 → /v1 API → 卸载关闭', async () => {
  const port = await freePort();
  const ctx = fakeCtx();
  apply(ctx, { port, host: '127.0.0.1', db: ':memory:' });
  try {
    const base = 'http://127.0.0.1:' + port + '/';
    await waitFor(async () => {
      try { return (await getJson(base + 'v1/health')).status === 200; } catch { return false; }
    });

    const { header, events } = loadFixture('fixture-01-completed-with-tool-errors.jsonl');
    const session = { header, snapshotEvents() { return events; } };
    const onSessionEvent = ctx.handlers.get('session/event');
    for (const event of events) onSessionEvent(session, event);

    const tasks = await getJson(base + 'v1/tasks');
    assert.equal(tasks.body.tasks.length, 1);
    assert.equal(tasks.body.tasks[0].task_id, header.id);
    assert.equal(tasks.body.tasks[0].state, 'succeeded');
    assert.equal(tasks.body.tasks[0].state_version, 2);

    // 实时 agent/status 只影响 agent_state。
    ctx.handlers.get('agent/status')({ agent: { id: header.id }, status: 'running' });
    const task = await getJson(base + 'v1/tasks/' + encodeURIComponent(header.id));
    assert.equal(task.body.agent_state, 'running');
    assert.equal(task.body.state, 'succeeded');

    // 卸载 → 服务关闭。
    ctx.dispose();
    await waitFor(async () => {
      try { await fetch(base + 'v1/health'); return false; } catch { return true; }
    }, { timeoutMs: 3000 });
  } finally {
    ctx.dispose();
  }
});

test('启动时 seed 已加载会话的历史事件', async () => {
  const port = await freePort();
  const { header, events } = loadFixture('fixture-05-subagent-session.jsonl');
  const session = { header, snapshotEvents() { return events; } };
  const ctx = fakeCtx([session]);
  apply(ctx, { port, host: '127.0.0.1', db: ':memory:' });
  try {
    const base = 'http://127.0.0.1:' + port + '/';
    await waitFor(async () => {
      try {
        const response = await getJson(base + 'v1/tasks');
        return response.status === 200 && response.body.tasks.length === 1;
      } catch { return false; }
    });
    const tasks = await getJson(base + 'v1/tasks');
    assert.equal(tasks.body.tasks[0].task_id, header.id);
    assert.equal(tasks.body.tasks[0].state, 'succeeded');
    assert.equal(tasks.body.tasks[0].delegation_depth, 1);
  } finally {
    ctx.dispose();
  }
});

test('启动时 seed live agent 的 status（agent/status 不落盘，错过即 unknown）', async () => {
  const port = await freePort();
  const { header, events } = loadFixture('fixture-02-approval-wait.jsonl');
  const session = { header, snapshotEvents() { return events; } };
  const agent = { id: header.id, status: 'running' };
  const ctx = fakeCtx([session], [agent]);
  apply(ctx, { port, host: '127.0.0.1', db: ':memory:' });
  try {
    const base = 'http://127.0.0.1:' + port + '/';
    await waitFor(async () => {
      try {
        const task = await getJson(base + 'v1/tasks/' + encodeURIComponent(header.id));
        return task.body && task.body.agent_state === 'running';
      } catch { return false; }
    });
    const task = await getJson(base + 'v1/tasks/' + encodeURIComponent(header.id));
    assert.equal(task.body.state, 'succeeded'); // 历史事件终态不变
    assert.equal(task.body.agent_state, 'running'); // 来自 live agent 状态
  } finally {
    ctx.dispose();
  }
});

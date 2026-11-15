import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WatchStore } from '../lib/core/store.mjs';

test('数据保留：删除过期事件与过期终态任务，不动运行中任务', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-store-prune-'));
  const store = new WatchStore({ path: path.join(dir, 'watch.db') });
  const now = Date.now();
  const old = now - 40 * 24 * 3600 * 1000;
  const recent = now - 1 * 24 * 3600 * 1000;
  store.upsertTask({ task_id: 'old-done', state: 'succeeded', updated_at: old });
  store.upsertTask({ task_id: 'old-running', state: 'running', updated_at: old });
  store.upsertTask({ task_id: 'new-done', state: 'failed', updated_at: recent });
  store.insertEvent({ event_id: 'old-done:0', task_id: 'old-done', seq: 0, occurred_at: old, type: 'run_started', payload: {} });
  store.insertEvent({ event_id: 'new-done:0', task_id: 'new-done', seq: 0, occurred_at: recent, type: 'run_started', payload: {} });
  const result = store.prune({ retentionDays: 30, now });
  assert.equal(result.tasks, 1); // old-done
  assert.equal(result.events, 1); // old-done:0
  assert.ok(store.getTask('old-done') === null);
  assert.ok(store.getTask('old-running')); // 运行中保留
  assert.ok(store.getTask('new-done'));
  assert.equal(store.stats().events, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

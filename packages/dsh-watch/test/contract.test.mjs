// 契约测试：快照/事件 JSON Schema 校验 + ID 规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../../contract/validate.mjs';
import { SCHEMA_VERSION, eventIdFor, runIdFor, STATES, TERMINAL_STATES } from '../lib/core/contract.mjs';
import { WatchStore } from '../lib/core/store.mjs';
import { Ingestor } from '../lib/core/pipeline.mjs';
import { sessionMeta } from '../lib/core/normalize.mjs';
import { REPO, loadFixture } from './helpers.mjs';

const SNAPSHOT_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'contract/schema/task-snapshot.schema.json'), 'utf8'));
const EVENT_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO, 'contract/schema/task-event.schema.json'), 'utf8'));

test('ID 规则：event_id = task:seq，run_id = task:turn', () => {
  assert.equal(SCHEMA_VERSION, '1.0');
  assert.equal(eventIdFor('session-a', 0), 'session-a:0');
  assert.equal(runIdFor('session-a', 3), 'session-a:3');
  assert.equal(runIdFor('session-a', undefined), null);
  assert.ok(STATES.includes('waiting_approval'));
  assert.ok(TERMINAL_STATES.has('succeeded'));
});

test('快照与事件符合 JSON Schema（用 fixture-02 真实窗口）', () => {
  const { header, events } = loadFixture('fixture-02-approval-wait.jsonl');
  const meta = sessionMeta(header);
  const store = new WatchStore();
  const ingestor = new Ingestor({ store });
  ingestor.ingestSessionEvents(meta, events);
  const snapshot = store.getTask(meta.task_id);
  const errors = validate(SNAPSHOT_SCHEMA, snapshot);
  assert.deepEqual(errors, [], 'snapshot schema violations: ' + JSON.stringify(errors));
  const stored = store.listEvents(meta.task_id, { afterSeq: -1, limit: 1000 });
  assert.ok(stored.length > 0);
  for (const event of stored) {
    const eventErrors = validate(EVENT_SCHEMA, { schema_version: SCHEMA_VERSION, ...event });
    assert.deepEqual(eventErrors, [], 'event schema violations: ' + JSON.stringify(eventErrors));
  }
  store.close();
});

test('快照对空任务也能通过契约校验（initialSnapshot）', async () => {
  const { initialSnapshot } = await import('../lib/core/normalize.mjs');
  const snapshot = initialSnapshot({
    task_id: 'session-empty', created_at: 1790000000000, cwd: null,
    delegation_depth: 0, parent_task_id: null, origin: null,
  });
  assert.deepEqual(validate(SNAPSHOT_SCHEMA, snapshot), []);
});

// 本地持久化：node:sqlite（Node 内置，零依赖）。M1 只存归一化快照与事件，不存原文。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { isState } from './contract.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT,
  seq INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task_seq ON events(task_id, seq);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class WatchStore {
  /** @param {{path?: string}} [options] */
  constructor({ path: dbPath = ':memory:' } = {}) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 2000;');
    if (dbPath !== ':memory:') {
      try { this.db.exec('PRAGMA journal_mode = WAL;'); } catch { /* 某些文件系统不支持 WAL，退回默认 */ }
    }
    this.db.exec(SCHEMA);
    this._insertEvent = this.db.prepare(
      'INSERT OR IGNORE INTO events(event_id, task_id, run_id, seq, occurred_at, type, payload) VALUES(?, ?, ?, ?, ?, ?, ?)',
    );
    this._getTask = this.db.prepare('SELECT snapshot FROM tasks WHERE task_id = ?');
    this._upsertTask = this.db.prepare(
      'INSERT INTO tasks(task_id, snapshot, updated_at) VALUES(?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at',
    );
    this._counts = this.db.prepare('SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM events) AS events');
  }

  /** 事务包装（ingest 的插入+快照更新原子化）。 */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }

  /** @returns {boolean} 是否真的插入了新事件（false = 重复 event_id） */
  insertEvent(event) {
    const result = this._insertEvent.run(
      event.event_id, event.task_id, event.run_id ?? null, event.seq, event.occurred_at, event.type, JSON.stringify(event.payload || {}),
    );
    return Number(result.changes) > 0;
  }

  getTask(taskId) {
    const row = this._getTask.get(taskId);
    return row ? JSON.parse(row.snapshot) : null;
  }

  upsertTask(snapshot) {
    this._upsertTask.run(snapshot.task_id, JSON.stringify(snapshot), snapshot.updated_at);
  }

  /**
   * @param {{state?: string, limit?: number, offset?: number}} [options]
   * @returns {object[]}
   */
  listTasks({ state = null, limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    let sql = 'SELECT snapshot FROM tasks';
    const params = [];
    if (state) {
      if (!isState(state)) throw new Error('invalid state filter: ' + state);
      sql += " WHERE json_extract(snapshot, '$.state') = ?";
      params.push(state);
    }
    sql += ' ORDER BY updated_at DESC, task_id ASC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);
    return this.db.prepare(sql).all(...params).map((row) => JSON.parse(row.snapshot));
  }

  /**
   * @param {string} taskId
   * @param {{afterSeq?: number, limit?: number}} [options]
   */
  listEvents(taskId, { afterSeq = -1, limit = 200 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const after = Number.isFinite(Number(afterSeq)) ? Number(afterSeq) : -1;
    const rows = this.db.prepare(
      'SELECT event_id, task_id, run_id, seq, occurred_at, type, payload FROM events WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    ).all(taskId, after, safeLimit);
    return rows.map((row) => ({
      event_id: row.event_id,
      task_id: row.task_id,
      run_id: row.run_id ?? null,
      seq: row.seq,
      occurred_at: row.occurred_at,
      type: row.type,
      payload: JSON.parse(row.payload),
    }));
  }

  /**
   * 数据保留：删除超过 retentionDays 的事件，以及超过 retentionDays 的终态任务快照。
   * 运行中/等待中的任务即使很旧也保留（用户可能仍需处理）。
   * @param {{retentionDays?: number, now?: number}} [options]
   */
  prune({ retentionDays = 30, now = Date.now() } = {}) {
    const days = Math.max(1, Number(retentionDays) || 30);
    const cutoff = now - days * 24 * 3600 * 1000;
    const events = this.db.prepare('DELETE FROM events WHERE occurred_at < ?').run(cutoff);
    const tasks = this.db.prepare(
      "DELETE FROM tasks WHERE updated_at < ? AND json_extract(snapshot, '$.state') IN ('succeeded','failed','cancelled')",
    ).run(cutoff);
    return { events: Number(events.changes), tasks: Number(tasks.changes), cutoff, retentionDays: days };
  }

  stats() {
    const row = this._counts.get();
    return { tasks: Number(row.tasks), events: Number(row.events) };
  }

  close() {
    try { this.db.close(); } catch { /* ignore */ }
  }
}

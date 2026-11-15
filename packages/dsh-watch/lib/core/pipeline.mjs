// 摄取管道：DSH 持久事件 → 归一化 → SQLite（事件去重 + 快照更新，单事务）。
// 实时事件（无 seq、不落盘）只更新快照。
import { initialSnapshot, normalizeEvent, sessionMeta } from './normalize.mjs';
import { applyEvent, applyLive } from './state.mjs';

export class Ingestor {
  /** @param {{store: import('./store.mjs').WatchStore, logger?: any}} options */
  constructor({ store, logger = null } = {}) {
    this.store = store;
    this.logger = logger;
    this.stats = { ingested: 0, ignored: 0, duplicates: 0, errors: 0 };
  }

  warn(message, error) {
    if (this.logger && typeof this.logger.warn === 'function') this.logger.warn('[dsh-watch] ' + message + (error ? ': ' + error.message : ''));
  }

  /**
   * 摄取一条 DSH 持久事件。
   * @param {ReturnType<typeof sessionMeta>} meta
   * @param {any} dshEvent
   */
  ingest(meta, dshEvent) {
    let event;
    try {
      event = normalizeEvent(meta, dshEvent);
    } catch (error) {
      this.stats.errors += 1;
      this.warn('normalize failed', error);
      return { ok: false, error };
    }
    if (!event) {
      this.stats.ignored += 1;
      return { ok: true, ignored: true };
    }
    try {
      return this.store.transaction(() => {
        const inserted = this.store.insertEvent(event);
        if (!inserted) {
          this.stats.duplicates += 1;
          return { ok: true, duplicate: true, event };
        }
        const prev = this.store.getTask(meta.task_id) || initialSnapshot(meta);
        const { snapshot, state_changed: stateChanged } = applyEvent(prev, meta, event);
        this.store.upsertTask(snapshot);
        this.stats.ingested += 1;
        return { ok: true, event, snapshot, state_changed: stateChanged };
      });
    } catch (error) {
      this.stats.errors += 1;
      this.warn('ingest failed for ' + meta.task_id + ' seq=' + dshEvent.seq, error);
      return { ok: false, error };
    }
  }

  /** 摄取一个会话的事件序列（插件启动 seed / 回放工具共用）。 */
  ingestSessionEvents(meta, events) {
    let applied = 0;
    for (const dshEvent of events || []) {
      const result = this.ingest(meta, dshEvent);
      if (result.ok && !result.ignored && !result.duplicate) applied += 1;
    }
    return applied;
  }

  /**
   * 实时事件：agent/status、agent/error、goal/changed（无 seq，不进 events 表）。
   * @param {string} taskId
   * @param {'agent_status'|'agent_error'|'goal_changed'} kind
   * @param {object} payload
   * @param {number} [at]
   */
  live(taskId, kind, payload, at = Date.now()) {
    try {
      return this.store.transaction(() => {
        const prev = this.store.getTask(taskId) || initialSnapshot({
          task_id: taskId, created_at: at, cwd: null,
          delegation_depth: 0, parent_task_id: null, origin: null,
        });
        const snapshot = applyLive(prev, kind, payload, at);
        this.store.upsertTask(snapshot);
        return snapshot;
      });
    } catch (error) {
      this.stats.errors += 1;
      this.warn('live update failed for ' + taskId, error);
      return null;
    }
  }
}

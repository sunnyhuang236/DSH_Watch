// 通知触发：轮询 dsh-watch /v1/tasks，按状态迁移生成通知意图（3 秒合并窗口 + 去重）。
// 只处理语义状态变化：进入终态（succeeded/failed/cancelled）或进入等待（waiting_input/waiting_approval）。

const WAITING = new Set(['waiting_input', 'waiting_approval']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function kindFor(state) {
  if (state === 'succeeded') return 'succeeded';
  if (state === 'failed') return 'failed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'waiting_input') return 'waiting_input';
  if (state === 'waiting_approval') return 'waiting_approval';
  return null;
}

export class NotificationWatcher {
  /**
   * @param {{store: import('./store.mjs').GatewayStore, push: import('./push.mjs').PushService,
   *          upstream?: string, intervalMs?: number, mergeWindowMs?: number, logger?: any}} options
   */
  constructor({ store, push, upstream = 'http://127.0.0.1:7317', intervalMs = 1000, mergeWindowMs = 3000, logger = null }) {
    this.store = store;
    this.push = push;
    this.upstream = upstream.replace(/\/+$/, '');
    this.intervalMs = intervalMs;
    this.mergeWindowMs = mergeWindowMs;
    this.logger = logger;
    this.timer = null;
    this.inFlight = false;
    this.seeded = false;
    this.lastStates = new Map();
    this.pending = new Map(); // task_id -> {kind, event_id, run_id, firstSeen, lastSeen}
    this.stats = { polls: 0, notifications: 0, retries: 0, failures: 0 };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async fetchTasks() {
    const response = await fetch(this.upstream + '/v1/tasks?limit=200', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('upstream ' + response.status);
    const body = await response.json();
    return Array.isArray(body.tasks) ? body.tasks : [];
  }

  async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const tasks = await this.fetchTasks();
      this.stats.polls += 1;
      const now = Date.now();
      const seen = new Set();
      for (const task of tasks) {
        const taskId = task.task_id;
        if (!taskId) continue;
        seen.add(taskId);
        const prev = this.lastStates.get(taskId);
        this.lastStates.set(taskId, { state: task.state, run_id: task.run_id || null, updated_at: task.updated_at || now });
        if (!this.seeded) continue; // 首次轮询只建立基线，避免网关启动狂发
        const kind = kindFor(task.state);
        const kindChanged = !prev || prev.state !== task.state || prev.run_id !== (task.run_id || null);
        // 离开等待：撤销尚未投递的等待提醒（即使新状态不是通知类型，例如 running）
        if (WAITING.has(prev && prev.state) && !WAITING.has(task.state)) this.pending.delete(taskId);
        if (!kind || !kindChanged) continue;
        const eventId = taskId + ':' + (task.run_id || '') + ':' + task.state;
        if (this.store.wasNotified(eventId)) continue;
        const existing = this.pending.get(taskId);
        if (existing && existing.event_id === eventId) continue;
        this.pending.set(taskId, {
          kind,
          event_id: eventId,
          run_id: task.run_id || null,
          firstSeen: now,
          lastSeen: now,
          nextAttempt: 0,
        });
      }
      // 已消失的任务不再保留
      for (const taskId of this.lastStates.keys()) if (!seen.has(taskId)) this.lastStates.delete(taskId);

      if (!this.seeded) { this.seeded = true; return; }
      await this.flush(now);
    } catch (error) {
      this.stats.failures += 1;
      if (this.logger && typeof this.logger.warn === 'function' && this.stats.failures % 30 === 1) {
        this.logger.warn('[gateway] watcher upstream unavailable: ' + error.message);
      }
    } finally {
      this.inFlight = false;
    }
  }

  async flush(now) {
    for (const [taskId, item] of [...this.pending.entries()]) {
      if (item.nextAttempt && now < item.nextAttempt) continue;
      if (now - item.firstSeen < this.mergeWindowMs) continue;
      this.pending.delete(taskId);
      if (this.store.wasNotified(item.event_id)) continue;
      const result = await this.push.sendToAll({
        v: 1,
        kind: item.kind,
        task: taskId,
        event: item.event_id,
        at: now,
      });
      this.stats.notifications += 1;
      if (result.sent > 0 || result.failed === 0) {
        this.store.markNotified(item.event_id, now);
      } else {
        // 全部订阅失败：保留待重试（30 秒后再试），不标记已通知
        item.nextAttempt = now + 30000;
        this.pending.set(taskId, item);
        this.stats.retries += 1;
      }
      if (result.sent > 0 || result.failed > 0) {
        if (this.logger && typeof this.logger.info === 'function') {
          this.logger.info('[gateway] notify ' + item.kind + ' ' + taskId.slice(0, 18) + ' sent=' + result.sent + ' failed=' + result.failed + (result.retried ? ' retried=' + result.retried : ''));
        }
      }
    }
  }
}

// M1 运行时：SQLite + 摄取管道 + 只读 API 的生命周期管理。
// 同一套运行时被 DSH 插件（lib/index.js）与回放/Tail 工具复用。
import os from 'node:os';
import path from 'node:path';
import { WatchStore } from './core/store.mjs';
import { Ingestor } from './core/pipeline.mjs';
import { sessionMeta } from './core/normalize.mjs';
import { startApi } from './api.mjs';
import { DEFAULT_HOST, DEFAULT_PORT } from './core/contract.mjs';

export const PLUGIN_VERSION = '0.1.0';

/** 插件默认本机库位置（DSH 数据目录下，M1 仅本机使用）。 */
export function defaultDbPath() {
  return path.join(os.homedir(), '.dsh', 'dsh-watch', 'watch.db');
}

function pickNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {{config?: object, logger?: any, version?: string}} [options]
 */
export function createWatchRuntime({ config = {}, logger = null, version = PLUGIN_VERSION } = {}) {
  const cfg = {
    host: typeof config.host === 'string' && config.host ? config.host : DEFAULT_HOST,
    port: config.port === 0 ? 0 : pickNumber(config.port, DEFAULT_PORT),
    dbPath: typeof config.db === 'string' && config.db ? config.db : defaultDbPath(),
    retentionDays: Math.max(1, pickNumber(config.retentionDays, 30)),
  };
  let store = null;
  let ingestor = null;
  let api = null;
  let pruneTimer = null;
  let started = false;
  let stopped = false;
  const pendingEvents = [];
  const seedQueue = [];
  const pendingAgentStates = [];

  function warn(message, error) {
    if (logger && typeof logger.warn === 'function') logger.warn('[dsh-watch] ' + message + (error ? ': ' + error.message : ''));
  }
  function info(message) {
    if (logger && typeof logger.info === 'function') logger.info('[dsh-watch] ' + message);
  }

  async function start() {
    if (started) return { url: api ? api.url : null, port: api ? api.port : null };
    if (stopped) return { url: null, port: null };
    store = openStore();
    try {
      const pruned = store.prune({ retentionDays: cfg.retentionDays });
      if (pruned.events || pruned.tasks) info('pruned old data events=' + pruned.events + ' tasks=' + pruned.tasks);
    } catch (error) { warn('prune failed', error); }
    ingestor = new Ingestor({ store, logger });
    const startedApi = await startApi({ store, host: cfg.host, port: cfg.port, version, logger });
    if (stopped) {
      // 启动过程中插件已被卸载：立即关闭，避免泄漏监听。
      await startedApi.close();
      return { url: null, port: null };
    }
    api = startedApi;
    started = true;
    pruneTimer = setInterval(() => {
      try { store.prune({ retentionDays: cfg.retentionDays }); } catch (error) { warn('periodic prune failed', error); }
    }, 24 * 3600 * 1000);
    if (pruneTimer.unref) pruneTimer.unref();
    // 启动前排队的实时事件 / 会话 seed 在这里补放。
    for (const [session, event] of pendingEvents.splice(0)) ingestSessionEvent(session, event);
    for (const sessions of seedQueue.splice(0)) seedSessions(sessions);
    for (const agents of pendingAgentStates.splice(0)) seedAgentStates(agents);
    info('listening ' + api.url + ' db=' + cfg.dbPath);
    return { url: api.url, port: api.port };
  }

  function openStore() {
    try {
      return new WatchStore({ path: cfg.dbPath });
    } catch (error) {
      warn('open db failed, falling back to memory: ' + cfg.dbPath, { message: error.message });
      return new WatchStore({ path: ':memory:' });
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
    const closeArray = [];
    if (api) closeArray.push(api.close());
    if (store) {
      try { store.close(); } catch (error) { warn('close store failed', error); }
    }
    return Promise.allSettled(closeArray);
  }

  /** 摄取一条 DSH 持久事件（session 为插件里的 live Session 对象）。 */
  function ingestSessionEvent(session, event) {
    if (!ingestor) {
      if (pendingEvents.length < 2000) pendingEvents.push([session, event]);
      return { ok: true, buffered: true };
    }
    const meta = sessionMeta(session);
    if (!meta.task_id) return { ok: false, error: new Error('session has no id') };
    return ingestor.ingest(meta, event);
  }

  /** 插件启动时把内存中已加载会话的历史事件回填（幂等，按 event_id 去重）。 */
  function seedSessions(sessions) {
    if (!ingestor) {
      if (seedQueue.length < 16) seedQueue.push(sessions);
      return 0;
    }
    let applied = 0;
    for (const session of sessions || []) {
      try {
        const meta = sessionMeta(session);
        if (!meta.task_id) continue;
        const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
        applied += ingestor.ingestSessionEvents(meta, events);
      } catch (error) {
        warn('seed session failed', error);
      }
    }
    if (applied > 0) info('seeded ' + applied + ' events from live sessions');
    return applied;
  }

  /** 插件启动/热重载时把当前 live agent 的 status 写入快照（agent/status 只实时、不落盘，错过就永远 unknown）。 */
  function seedAgentStates(agents) {
    if (!ingestor) {
      if (pendingAgentStates.length < 64) pendingAgentStates.push(agents);
      return 0;
    }
    let applied = 0;
    for (const agent of agents || []) {
      if (!agent || typeof agent.id !== 'string') continue;
      if (agent.status !== 'running' && agent.status !== 'idle') continue;
      if (ingestor.live(agent.id, 'agent_status', { status: agent.status })) applied += 1;
    }
    if (applied > 0) info('seeded agent status for ' + applied + ' live agents');
    return applied;
  }

  return {
    start,
    stop,
    ingestSessionEvent,
    seedSessions,
    seedAgentStates,
    onAgentStatus(agent, status) {
      const taskId = agent && agent.id;
      if (!taskId) return null;
      if (!ingestor) return null;
      return ingestor.live(taskId, 'agent_status', { status });
    },
    onAgentError(agent, error) {
      const taskId = agent && agent.id;
      if (!taskId || !ingestor) return null;
      return ingestor.live(taskId, 'agent_error', { message_len: typeof (error && error.message) === 'string' ? error.message.length : 0 });
    },
    onGoalChanged(agent, change) {
      const taskId = agent && agent.id;
      if (!taskId || !ingestor) return null;
      return ingestor.live(taskId, 'goal_changed', { phase: change && change.goal ? change.goal.phase : null });
    },
    get url() { return api ? api.url : null; },
    get port() { return api ? api.port : null; },
    get dbPath() { return cfg.dbPath; },
    get store() { return store; },
    get ingestor() { return ingestor; },
  };
}

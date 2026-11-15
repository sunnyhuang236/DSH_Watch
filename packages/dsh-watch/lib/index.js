// dsh-watch M1 DSH 插件入口（host 侧）。
// 订阅：session/event（全部会话，持久事件）、agent/status、agent/error、goal/changed；
// 数据流：归一化 → SQLite → /v1 只读 API + 浏览器调试面板。
import { createWatchRuntime } from './runtime.mjs';
import { PLUGIN_VERSION } from './runtime.mjs';

export const name = 'dsh-watch';
export const inject = ['sessions', 'agents'];
export const version = PLUGIN_VERSION;

/**
 * Cordis 插件入口。config 来自 cordis.patch.yml 的 insert.config：
 *   { port?: number, host?: string, db?: string }
 */
export function apply(ctx, config = {}) {
  const runtime = createWatchRuntime({ config, logger: ctx.logger });

  // 启动 HTTP API + 本机库；插件卸载时关闭。
  ctx.effect(() => {
    runtime.start().catch((error) => {
      if (ctx.logger && typeof ctx.logger.error === 'function') ctx.logger.error('[dsh-watch] start failed: ' + error.message);
    });
    return () => { runtime.stop(); };
  }, 'dsh-watch.start');

  // 订阅持久事件（global: 所有会话，含子代理会话）与实时事件。
  ctx.effect(() => {
    const disposers = [];
    disposers.push(ctx.on('session/event', (session, event) => {
      runtime.ingestSessionEvent(session, event);
    }, { global: true }));
    disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      runtime.onAgentStatus(agent, status);
    }, { global: true }));
    // agent/status 只在状态「变化」时发出；插件加载/热重载后才创建的 agent 不会有变化事件，
    // 因此监听 agent/created 主动写入它的当前 status。
    disposers.push(ctx.on('agent/created', ({ agent }) => {
      runtime.seedAgentStates([agent]);
    }, { global: true }));
    disposers.push(ctx.on('agent/error', ({ agent, error }) => {
      runtime.onAgentError(agent, error);
    }, { global: true }));
    disposers.push(ctx.on('goal/changed', ({ agent, change }) => {
      runtime.onGoalChanged(agent, change);
    }, { global: true }));
    return () => {
      for (const dispose of disposers) { try { if (typeof dispose === 'function') dispose(); } catch { /* ignore */ } }
    };
  }, 'dsh-watch.listeners');

  // M4-A 审批桥：先于远程 UI 进入 waterfall，但始终调用 next() 保留桌面审批；
  // 手机 decision 与桌面结果竞速，先到者生效。
  ctx.effect(() => {
    const dispose = ctx.on('approval/request', (request, next) => runtime.onApproval(request, next), { global: true, prepend: true });
    return () => { try { if (typeof dispose === 'function') dispose(); } catch { /* ignore */ } };
  }, 'dsh-watch.approval-bridge');

  // M4-B 问答桥：同样先于远程 UI 进入 waterfall，但保留 next() 给桌面回答。
  ctx.effect(() => {
    const dispose = ctx.on('user-questions/request', (request, next) => runtime.onQuestion(request, next), { global: true, prepend: true });
    return () => { try { if (typeof dispose === 'function') dispose(); } catch { /* ignore */ } };
  }, 'dsh-watch.question-bridge');

  // 启动时把 DSH 内存里已加载会话的历史事件回填（幂等；live 事件会继续追加），
  // 并把当前 live agent 的 status 写入快照（agent/status 不落盘，错过启动窗口就永远 unknown）。
  ctx.effect(() => {
    let sessions = [];
    let agents = [];
    try {
      sessions = typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : [];
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[dsh-watch] list sessions failed: ' + error.message);
    }
    try {
      agents = typeof ctx.agents.list === 'function' ? ctx.agents.list() : [];
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[dsh-watch] list agents failed: ' + error.message);
    }
    runtime.seedSessions(sessions);
    runtime.seedAgentStates(agents);
  }, 'dsh-watch.seed');
}

export default { name, inject, apply, version };

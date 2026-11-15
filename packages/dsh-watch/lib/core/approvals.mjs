// M4-A 审批桥：监听 DSH approval/request，手机端通过网关提交一次性决定。
// 重要：DSH 的 approval/request 是 waterfall；本模块用 next() 保留桌面 UI，
// 桌面和手机谁先给出有效决定谁生效，后到者返回 conflict/expired。
import crypto from 'node:crypto';

const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);
const MOBILE_DECISIONS = new Set(['allowed-once', 'rejected']);

function taskIdOf(request) {
  const session = request && request.agent && request.agent.session;
  return (session && (session.id || (session.header && session.header.id))) || null;
}

export class ApprovalBridge {
  constructor({ logger = null, ttlMs = 5 * 60 * 1000 } = {}) {
    this.logger = logger;
    this.ttlMs = ttlMs;
    this.actions = new Map();
  }

  /** 供 DSH approval/request waterfall 调用；返回最终 outcome。 */
  async handle(request, next) {
    if (!request || typeof next !== 'function') return 'unavailable';
    const actionId = 'act_' + crypto.randomUUID();
    const now = Date.now();
    const action = {
      action_id: actionId,
      task_id: taskIdOf(request),
      tool_name: request.toolName || 'unknown',
      call_id: request.callId || null,
      reason: request.reason || null,
      display_reason: request.displayReason || null,
      created_at: now,
      expires_at: now + this.ttlMs,
      status: 'pending',
      outcome: null,
      decision: null,
      _resolve: null,
    };
    const mobile = new Promise((resolve) => { action._resolve = resolve; });
    this.actions.set(actionId, action);

    let abortResolve;
    const aborted = new Promise((resolve) => { abortResolve = resolve; });
    const onAbort = () => {
      if (action.status === 'pending') {
        action.status = 'expired';
        action.outcome = 'cancelled';
        abortResolve('cancelled');
        if (action._resolve) action._resolve('cancelled');
      }
    };
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
    }

    let desktopOutcome = null;
    const desktop = Promise.resolve()
      .then(() => next())
      .then((outcome) => {
        desktopOutcome = OUTCOMES.has(outcome) ? outcome : 'unavailable';
        if (action.status === 'pending') {
          action.status = 'resolved';
          action.outcome = desktopOutcome;
          action.decision = 'desktop';
        }
        return desktopOutcome;
      })
      .catch(() => {
        desktopOutcome = 'unavailable';
        if (action.status === 'pending') {
          action.status = 'resolved';
          action.outcome = 'unavailable';
          action.decision = 'desktop';
        }
        return 'unavailable';
      });

    const result = await Promise.race([
      desktop.then((outcome) => ({ source: 'desktop', outcome })),
      mobile.then((outcome) => ({ source: 'mobile', outcome })),
      aborted.then((outcome) => ({ source: 'abort', outcome })),
    ]);
    if (request.signal && typeof request.signal.removeEventListener === 'function') {
      request.signal.removeEventListener('abort', onAbort);
    }
    // 桌面先答时，手机端仍可能看到 pending；保留为 resolved 供 PWA 展示。
    if (result.source === 'desktop') return result.outcome;
    if (result.source === 'abort') return 'cancelled';
    return result.outcome;
  }

  /** 手机提交一次性决定。 */
  decide(actionId, decision) {
    const action = this.actions.get(actionId);
    if (!action) return { status: 'expired', action_id: actionId };
    if (!MOBILE_DECISIONS.has(decision)) return { status: 'bad_request', action_id: actionId };
    if (Date.now() > action.expires_at) {
      action.status = 'expired';
      if (action._resolve) action._resolve('unavailable');
      return { status: 'expired', action_id: actionId };
    }
    if (action.status !== 'pending') {
      return {
        status: 'conflict', action_id: actionId,
        current_status: action.status, current_decision: action.decision,
      };
    }
    action.status = 'decided';
    action.outcome = decision;
    action.decision = 'mobile';
    if (action._resolve) action._resolve(decision);
    return { status: 'accepted', action_id: actionId, decision };
  }

  list({ taskId = null, includeResolved = true } = {}) {
    const cutoff = Date.now() - this.ttlMs;
    return [...this.actions.values()]
      .filter((action) => (!taskId || action.task_id === taskId))
      .filter((action) => includeResolved || action.status === 'pending')
      .filter((action) => action.created_at >= cutoff)
      .sort((a, b) => b.created_at - a.created_at)
      .map((action) => this.publicView(action));
  }

  get(actionId) {
    const action = this.actions.get(actionId);
    return action ? this.publicView(action) : null;
  }

  publicView(action) {
    return {
      action_id: action.action_id,
      task_id: action.task_id,
      tool_name: action.tool_name,
      call_id: action.call_id,
      reason: action.reason,
      display_reason: action.display_reason,
      created_at: action.created_at,
      expires_at: action.expires_at,
      status: action.status,
      outcome: action.outcome,
      decision: action.decision,
    };
  }

  prune() {
    const cutoff = Date.now() - this.ttlMs * 2;
    for (const [id, action] of this.actions) {
      if (action.created_at < cutoff) this.actions.delete(id);
    }
  }
}

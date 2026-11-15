// M4-B 问答桥：监听 DSH user-questions/request，手机端提交结构化答案。
// 与审批桥一样保留桌面 UI（next()），桌面/手机先答者生效；手机答案必须是
// 每个问题 id 恰好一次，选项标签必须属于该问题的 options。
import crypto from 'node:crypto';

function taskIdOf(request) {
  const session = request && request.agent && request.agent.session;
  return (session && (session.id || (session.header && session.header.id))) || null;
}

function cleanQuestion(question) {
  return {
    id: String(question.id),
    header: question.header || null,
    question: String(question.question || ''),
    detail: question.detail || null,
    options: Array.isArray(question.options)
      ? question.options.map((option) => ({ label: String(option.label), description: option.description || null }))
      : [],
    multi_select: question.multiSelect === true,
    intent: question.intent || null,
  };
}

export class QuestionBridge {
  constructor({ logger = null, ttlMs = 5 * 60 * 1000 } = {}) {
    this.logger = logger;
    this.ttlMs = ttlMs;
    this.questions = new Map();
  }

  async handle(request, next) {
    if (!request || !Array.isArray(request.questions) || request.questions.length === 0) {
      return typeof next === 'function' ? next() : { answers: [] };
    }
    if (typeof next !== 'function') throw new Error('user-questions bridge needs next()');
    const actionId = 'q_' + crypto.randomUUID();
    const now = Date.now();
    const action = {
      action_id: actionId,
      task_id: taskIdOf(request),
      questions: request.questions.map(cleanQuestion),
      created_at: now,
      expires_at: now + this.ttlMs,
      status: 'pending',
      decision: null,
      answers: null,
      _resolve: null,
    };
    const mobile = new Promise((resolve) => { action._resolve = resolve; });
    this.questions.set(actionId, action);

    let abortResolve;
    const aborted = new Promise((resolve) => { abortResolve = resolve; });
    const onAbort = () => {
      if (action.status === 'pending') {
        action.status = 'expired';
        abortResolve({ answers: [] });
        if (action._resolve) action._resolve({ answers: [] });
      }
    };
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
    }

    const desktop = Promise.resolve()
      .then(() => next())
      .then((answer) => {
        if (action.status === 'pending') {
          action.status = 'resolved';
          action.decision = 'desktop';
          action.answers = answer;
        }
        return answer;
      })
      .catch((error) => {
        if (action.status === 'pending') {
          action.status = 'resolved';
          action.decision = 'desktop';
        }
        throw error;
      });

    let result;
    try {
      result = await Promise.race([
        desktop.then((answer) => ({ source: 'desktop', answer })),
        mobile.then((answer) => ({ source: 'mobile', answer })),
        aborted.then(() => ({ source: 'abort', answer: { answers: [] } })),
      ]);
    } finally {
      if (request.signal && typeof request.signal.removeEventListener === 'function') {
        request.signal.removeEventListener('abort', onAbort);
      }
    }
    if (result.source === 'desktop') return result.answer;
    if (result.source === 'abort') throw Object.assign(new Error('question aborted'), { code: 'ASK_ABORTED' });
    return result.answer;
  }

  answer(actionId, answers) {
    const action = this.questions.get(actionId);
    if (!action) return { status: 'expired', action_id: actionId };
    if (Date.now() > action.expires_at) {
      action.status = 'expired';
      if (action._resolve) action._resolve({ answers: [] });
      return { status: 'expired', action_id: actionId };
    }
    if (action.status !== 'pending') return { status: 'conflict', action_id: actionId, current_status: action.status, current_decision: action.decision };
    if (!Array.isArray(answers)) return { status: 'bad_request', action_id: actionId, message: 'answers must be an array' };
    const expected = new Set(action.questions.map((question) => question.id));
    const seen = new Set();
    for (const answer of answers) {
      if (!answer || typeof answer.id !== 'string' || !expected.has(answer.id) || seen.has(answer.id)) {
        return { status: 'bad_request', action_id: actionId, message: 'each question id must appear exactly once' };
      }
      seen.add(answer.id);
      if (!Array.isArray(answer.selected)) return { status: 'bad_request', action_id: actionId, message: 'selected must be an array' };
      const question = action.questions.find((item) => item.id === answer.id);
      const labels = new Set(question.options.map((option) => option.label));
      if (answer.selected.some((label) => !labels.has(label))) return { status: 'bad_request', action_id: actionId, message: 'selected contains an unknown option' };
      if (question.multi_select !== true && answer.selected.length > 1) return { status: 'bad_request', action_id: actionId, message: 'single-select cannot have multiple options' };
    }
    if (seen.size !== expected.size) return { status: 'bad_request', action_id: actionId, message: 'answer batch does not cover every question' };
    action.status = 'answered';
    action.decision = 'mobile';
    action.answers = { answers };
    if (action._resolve) action._resolve({ answers });
    return { status: 'accepted', action_id: actionId, answers };
  }

  list({ taskId = null, includeResolved = true } = {}) {
    const cutoff = Date.now() - this.ttlMs;
    return [...this.questions.values()]
      .filter((action) => (!taskId || action.task_id === taskId))
      .filter((action) => includeResolved || action.status === 'pending')
      .filter((action) => action.created_at >= cutoff)
      .sort((a, b) => b.created_at - a.created_at)
      .map((action) => this.publicView(action));
  }

  get(actionId) {
    const action = this.questions.get(actionId);
    return action ? this.publicView(action) : null;
  }

  publicView(action) {
    return {
      action_id: action.action_id,
      task_id: action.task_id,
      questions: action.questions,
      created_at: action.created_at,
      expires_at: action.expires_at,
      status: action.status,
      decision: action.decision,
      answers: action.answers,
    };
  }

  prune() {
    const cutoff = Date.now() - this.ttlMs * 2;
    for (const [id, action] of this.questions) if (action.created_at < cutoff) this.questions.delete(id);
  }
}

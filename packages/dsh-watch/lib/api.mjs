// 只读 HTTP API（M1）：/v1/health、/v1/tasks、/v1/tasks/{id}、/v1/tasks/{id}/events、/（调试面板）。
// 仅监听 127.0.0.1；无鉴权（M2 才加配对/设备凭证）；全部 GET、不写业务数据。
import http from 'node:http';
import {
  SERVICE_NAME, SCHEMA_VERSION, CONTRACT_VERSION, CAPABILITIES,
  ERROR_CODES, STATES, isState,
} from './core/contract.mjs';
import { renderPanel } from './panel.mjs';

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: { code, message } });
}

/**
 * @param {{store: import('./core/store.mjs').WatchStore, host?: string, port?: number, version?: string, logger?: any, approvals?: import('./core/approvals.mjs').ApprovalBridge, questions?: import('./core/questions.mjs').QuestionBridge}} options
 */
export async function startApi({ store, host = '127.0.0.1', port = 0, version = '0.1.0', logger = null, approvals = null, questions = null }) {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        if (logger && typeof logger.error === 'function') logger.error('[dsh-watch] api error: ' + error.message);
        if (!res.headersSent) sendError(res, 500, ERROR_CODES.INTERNAL_ERROR, 'internal error');
      });
  });

  async function readJson(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 65536) throw new Error('body too large');
    }
    if (!text.trim()) return {};
    return JSON.parse(text);
  }

  async function handle(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://' + host);
    const pathname = url.pathname;
    const decisionMatch = pathname.match(/^\/v1\/actions\/([^/]+)\/decision$/);
    const actionMatch = pathname.match(/^\/v1\/actions\/([^/]+)$/);
    const questionAnswerMatch = pathname.match(/^\/v1\/questions\/([^/]+)\/answer$/);
    const questionMatch = pathname.match(/^\/v1\/questions\/([^/]+)$/);
    const isDecision = method === 'POST' && Boolean(decisionMatch);
    const isQuestionAnswer = method === 'POST' && Boolean(questionAnswerMatch);
    if (method !== 'GET' && method !== 'HEAD' && !isDecision && !isQuestionAnswer) {
      res.setHeader('Allow', 'GET, HEAD, POST');
      sendError(res, 405, ERROR_CODES.METHOD_NOT_ALLOWED, 'only GET/HEAD/POST decision is supported');
      return;
    }
    // ---- M4 审批 action ----
    if (pathname === '/v1/actions' && method === 'GET') {
      if (!approvals) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'approval bridge not enabled'); return; }
      const taskId = url.searchParams.get('task_id');
      const includeResolved = url.searchParams.get('include_resolved') !== '0';
      sendJson(res, 200, { schema_version: SCHEMA_VERSION, actions: approvals.list({ taskId, includeResolved }) });
      return;
    }
    if (actionMatch && method === 'GET') {
      if (!approvals) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'approval bridge not enabled'); return; }
      const action = approvals.get(decodeURIComponent(actionMatch[1]));
      if (!action) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'action not found'); return; }
      sendJson(res, 200, action);
      return;
    }
    if (decisionMatch && method === 'POST') {
      if (!approvals) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'approval bridge not enabled'); return; }
      let body;
      try { body = await readJson(req); } catch (error) { sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'invalid JSON body'); return; }
      const result = approvals.decide(decodeURIComponent(decisionMatch[1]), String(body.decision || ''));
      if (result.status === 'accepted') { sendJson(res, 200, result); return; }
      if (result.status === 'bad_request') { sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'decision must be allowed-once or rejected'); return; }
      if (result.status === 'conflict') { sendJson(res, 409, result); return; }
      sendJson(res, 410, result);
      return;
    }
    // ---- M4-B user questions ----
    if (pathname === '/v1/questions' && method === 'GET') {
      if (!questions) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'question bridge not enabled'); return; }
      const taskId = url.searchParams.get('task_id');
      const includeResolved = url.searchParams.get('include_resolved') !== '0';
      sendJson(res, 200, { schema_version: SCHEMA_VERSION, questions: questions.list({ taskId, includeResolved }) });
      return;
    }
    if (questionMatch && method === 'GET') {
      if (!questions) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'question bridge not enabled'); return; }
      const action = questions.get(decodeURIComponent(questionMatch[1]));
      if (!action) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'question not found'); return; }
      sendJson(res, 200, action);
      return;
    }
    if (questionAnswerMatch && method === 'POST') {
      if (!questions) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'question bridge not enabled'); return; }
      let body;
      try { body = await readJson(req); } catch (error) { sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'invalid JSON body'); return; }
      const result = questions.answer(decodeURIComponent(questionAnswerMatch[1]), body.answers);
      if (result.status === 'accepted') { sendJson(res, 200, result); return; }
      if (result.status === 'bad_request') { sendError(res, 400, ERROR_CODES.BAD_REQUEST, result.message || 'invalid answers'); return; }
      if (result.status === 'conflict') { sendJson(res, 409, result); return; }
      sendJson(res, 410, result);
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(renderPanel({ version, contract: CONTRACT_VERSION, states: STATES }));
      return;
    }
    if (pathname === '/v1/health') {
      const stats = store.stats();
      sendJson(res, 200, {
        ok: true,
        service: SERVICE_NAME,
        version,
        schema_version: SCHEMA_VERSION,
        contract: CONTRACT_VERSION,
        capabilities: CAPABILITIES,
        stats,
        uptime_s: Math.round((Date.now() - startedAt) / 1000),
        time: Date.now(),
      });
      return;
    }
    if (pathname === '/v1/tasks') {
      const state = url.searchParams.get('state');
      if (state && !isState(state)) {
        sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'invalid state: ' + state);
        return;
      }
      const limit = Number(url.searchParams.get('limit') || 100);
      const cursor = Number(url.searchParams.get('cursor') || 0);
      if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(cursor) || cursor < 0) {
        sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'invalid limit/cursor');
        return;
      }
      const tasks = store.listTasks({ state: state || null, limit, offset: cursor });
      const next = tasks.length === Math.min(Math.max(limit, 1), 500) ? String(cursor + tasks.length) : null;
      sendJson(res, 200, { schema_version: SCHEMA_VERSION, tasks, next_cursor: next });
      return;
    }
    const taskMatch = pathname.match(/^\/v1\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1]);
      const snapshot = store.getTask(taskId);
      if (!snapshot) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'task not found'); return; }
      sendJson(res, 200, snapshot);
      return;
    }
    const eventsMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/events$/);
    if (eventsMatch) {
      const taskId = decodeURIComponent(eventsMatch[1]);
      if (!store.getTask(taskId)) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'task not found'); return; }
      const afterSeq = Number(url.searchParams.get('after_seq') || -1);
      const limit = Number(url.searchParams.get('limit') || 200);
      if (!Number.isFinite(afterSeq) || !Number.isFinite(limit) || limit < 1) {
        sendError(res, 400, ERROR_CODES.BAD_REQUEST, 'invalid after_seq/limit');
        return;
      }
      const events = store.listEvents(taskId, { afterSeq, limit });
      const next = events.length === Math.min(Math.max(limit, 1), 1000) ? String(events[events.length - 1].seq) : null;
      sendJson(res, 200, { schema_version: SCHEMA_VERSION, task_id: taskId, events, next_cursor: next });
      return;
    }
    sendError(res, 404, ERROR_CODES.NOT_FOUND, 'not found');
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const actualPort = server.address().port;
  return {
    server,
    host,
    port: actualPort,
    url: 'http://' + host + ':' + actualPort + '/',
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    },
  };
}

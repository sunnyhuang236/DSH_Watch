// M1 契约常量（唯一实现来源；contract/README.md 与 contract/schema/*.json 是文档与校验层）。
// m1-v1.1：2026-11-05 在 m1-v1.0 基础上补充第三方实测 failed 终态与 4 种源码 reason 映射。
export const SCHEMA_VERSION = '1.0';
export const SERVICE_NAME = 'dsh-watch';
export const CONTRACT_VERSION = 'm1-v1.1';

export const STATES = Object.freeze([
  'unknown', 'running', 'waiting_input', 'waiting_approval', 'succeeded', 'failed', 'cancelled',
]);
export const TERMINAL_STATES = Object.freeze(new Set(['succeeded', 'failed', 'cancelled']));
export const WAITING_STATES = Object.freeze(new Set(['waiting_input', 'waiting_approval']));
export const CONNECTION_STATES = Object.freeze(['online', 'reconnecting', 'offline', 'unknown']);
export const AGENT_STATES = Object.freeze(['unknown', 'idle', 'running']);

export const CAPABILITIES = Object.freeze({ approval: true, cost: false, agents: true });

export const EVENT_TYPES = Object.freeze([
  'run_started', 'run_finished', 'step_started', 'step_finished',
  'tool_started', 'tool_finished', 'assistant', 'user_message',
  'approval_requested', 'approval_decided', 'job_started', 'job_finished',
  'title', 'subagent', 'team', 'goal', 'diagnostic', 'unknown',
]);

// DSH 内部/噪声事件：不进产品库（M0 已确认它们不承载任务语义，或与其它事件重复）。
export const DSH_IGNORED_TYPES = new Set([
  'request/header', 'request/context',
  'session/title-llm-request', 'web/deepseek-search-llm-request',
  'session-log-deepseek/delivery-accepted',
  'compaction/prune', 'compaction/start', 'compaction/summary', 'compaction/end',
  'session/end-seed', 'system/message', 'workspace/changes', 'todo/write',
  'deliverables/presented', 'permission/preset', 'sandbox/mode', 'approval/policy',
  'agent/inbox/spliced', // 与 user/message 重复表示同一条消息
]);

// 已知但只作诊断保留的 DSH 事件。
export const DSH_DIAGNOSTIC_TYPES = new Set([
  'assistant/attempt', 'llm/retry', 'llm/retry-started',
  'command/run', 'command/done', 'subagent/descriptor',
]);

// 视为"等待用户输入"的工具名（M0 实测：ask_user_question 的 tool/call 与 tool/result 之间是等待窗口）。
export const ASK_TOOL_NAMES = new Set(['ask_user_question']);

export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'bad_request',
  NOT_FOUND: 'not_found',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  INTERNAL_ERROR: 'internal_error',
});

export const DEFAULT_PORT = 7317;
export const DEFAULT_HOST = '127.0.0.1';

export function eventIdFor(taskId, seq) {
  return taskId + ':' + seq;
}

export function runIdFor(taskId, turn) {
  return typeof turn === 'number' && Number.isFinite(turn) ? taskId + ':' + turn : null;
}

export function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

export function isState(value) {
  return STATES.includes(value);
}

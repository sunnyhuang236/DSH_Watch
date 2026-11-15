// DSH session/event → 归一化 TaskEvent（M1 契约 v0.1）。
import {
  SCHEMA_VERSION, eventIdFor, runIdFor, ASK_TOOL_NAMES,
  DSH_IGNORED_TYPES, DSH_DIAGNOSTIC_TYPES,
} from './contract.mjs';
import { sanitizeText, basenameSafe, lengthOf } from './redact.mjs';

/**
 * 从 DSH Session 对象或 session header 提取任务元数据。
 * 插件里传入 live Session（有 .header）；回放工具里直接传入 header。
 * @param {any} source
 */
export function sessionMeta(source) {
  const h = (source && source.header) ? source.header : (source || {});
  return {
    task_id: typeof h.id === 'string' ? h.id : null,
    created_at: Number.isFinite(h.createdAt) ? h.createdAt : 0,
    cwd: typeof h.cwd === 'string' ? h.cwd : null,
    delegation_depth: Number.isInteger(h.delegationDepth) && h.delegationDepth >= 0 ? h.delegationDepth : 0,
    parent_task_id: typeof h.parentSession === 'string' ? h.parentSession : null,
    origin: typeof h.origin === 'string' ? h.origin : null,
    agent_preset: typeof h.agentPreset === 'string' ? h.agentPreset : null,
    is_seeded: h.isSeeded === true,
  };
}

/** 初始快照（状态 unknown，等待首个 turn/step 事件）。 */
export function initialSnapshot(meta) {
  return {
    schema_version: SCHEMA_VERSION,
    task_id: meta.task_id,
    run_id: null,
    state: 'unknown',
    state_version: 0,
    title: basenameSafe(meta.cwd) || meta.task_id,
    summary: '等待事件',
    started_at: null,
    updated_at: meta.created_at || 0,
    last_activity_at: null,
    ended_at: null,
    capabilities: { approval: true, cost: false, agents: true },
    cost: null,
    token_usage: null,
    agent_count: 0,
    agent_state: 'unknown',
    connection: 'online',
    delegation_depth: meta.delegation_depth,
    parent_task_id: meta.parent_task_id,
    origin: meta.origin,
    current_step: null,
    current_tool: null,
    waiting: null,
  };
}

function usageOf(data) {
  const u = data && data.usage;
  if (!u || typeof u !== 'object') return null;
  const num = (k) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? u[k] : 0);
  return {
    input_tokens: num('inputTokens'),
    output_tokens: num('outputTokens'),
    cache_read_tokens: num('cacheReadTokens'),
    cache_write_tokens: num('cacheWriteTokens'),
    total_tokens: num('totalTokens'),
  };
}

function contentText(data) {
  const content = (data && data.message && data.message.content) || (data && data.content);
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return null;
}

function makeEvent(meta, dshEvent, type, payload) {
  const turn = dshEvent.data && dshEvent.data.turn;
  return {
    schema_version: SCHEMA_VERSION,
    event_id: eventIdFor(meta.task_id, dshEvent.seq),
    task_id: meta.task_id,
    run_id: runIdFor(meta.task_id, turn),
    seq: dshEvent.seq,
    type,
    occurred_at: dshEvent.time,
    payload,
  };
}

/**
 * 归一化一条 DSH 持久事件；返回 null 表示该事件按契约忽略。
 * @param {ReturnType<typeof sessionMeta>} meta
 * @param {{type:string,seq:number,time:number,data:any}} dshEvent
 * @returns {object|null}
 */
export function normalizeEvent(meta, dshEvent) {
  if (!meta || typeof meta.task_id !== 'string') return null;
  if (!dshEvent || typeof dshEvent.type !== 'string') return null;
  if (!Number.isInteger(dshEvent.seq) || dshEvent.seq < 0) return null;
  if (!Number.isFinite(dshEvent.time)) return null;
  if (DSH_IGNORED_TYPES.has(dshEvent.type)) return null;
  const d = dshEvent.data || {};
  switch (dshEvent.type) {
    case 'turn/start':
      return makeEvent(meta, dshEvent, 'run_started', { turn: d.turn });
    case 'step/start':
      return makeEvent(meta, dshEvent, 'step_started', { turn: d.turn, step: d.step });
    case 'step/end':
      return makeEvent(meta, dshEvent, 'step_finished', { turn: d.turn, step: d.step });
    case 'turn/end': {
      const reason = d.reason || {};
      const kind = typeof reason.kind === 'string' ? reason.kind : null;
      const fallbackCode = kind === 'max-tokens' ? 'MAX_TOKENS' : kind === 'blocked' ? 'BLOCKED' : null;
      return makeEvent(meta, dshEvent, 'run_finished', {
        turn: d.turn,
        reason_kind: kind,
        reason_detail: reason.reason && typeof reason.reason.kind === 'string' ? reason.reason.kind : null,
        // 源码：turn/end.reason={kind:"error", error:{message, code}}（message 不落库，只保留 code）
        error_code: reason.error && typeof reason.error.code === 'string'
          ? sanitizeText(reason.error.code, 40)
          : fallbackCode,
      });
    }
    case 'tool/call':
      return makeEvent(meta, dshEvent, 'tool_started', {
        turn: d.turn, step: d.step, call_id: String(d.callId ?? ''), name: String(d.name ?? ''),
        is_question: ASK_TOOL_NAMES.has(String(d.name ?? '')),
      });
    case 'tool/result': {
      const message = d.message || {};
      const metaInfo = d.meta || {};
      const exitCode = metaInfo.opsShell && typeof metaInfo.opsShell.exitCode === 'number' ? metaInfo.opsShell.exitCode : null;
      return makeEvent(meta, dshEvent, 'tool_finished', {
        turn: d.turn, step: d.step,
        call_id: String(message.toolCallId ?? (message.source && message.source.callId) ?? ''),
        is_error: message.isError === true,
        exit_code: exitCode,
      });
    }
    case 'assistant/message': {
      const content = d.message && Array.isArray(d.message.content) ? d.message.content : [];
      return makeEvent(meta, dshEvent, 'assistant', {
        turn: d.turn, step: d.step,
        usage: usageOf(d),
        interrupted: d.interrupted === true,
        content_types: content.map((block) => (block && typeof block.type === 'string' ? block.type : 'unknown')),
      });
    }
    case 'user/message': {
      const sourceKind = (d.source && d.source.kind) || 'unknown';
      const isHuman = sourceKind === 'user';
      const text = isHuman ? sanitizeText(contentText(d), 80) : null;
      return makeEvent(meta, dshEvent, 'user_message', {
        source_kind: sourceKind,
        is_human: isHuman,
        text_len: lengthOf(contentText(d)),
        title: text,
      });
    }
    case 'approval/asked':
      return makeEvent(meta, dshEvent, 'approval_requested', {
        approval_id: String(d.id ?? ''),
        tool_name: sanitizeText(d.toolName, 64),
        call_id: String(d.callId ?? ''),
        reason_len: lengthOf(d.reason),
      });
    case 'approval/decided':
      return makeEvent(meta, dshEvent, 'approval_decided', {
        approval_id: String(d.id ?? ''),
        outcome: sanitizeText(d.outcome, 40),
      });
    case 'job/registered':
      return makeEvent(meta, dshEvent, 'job_started', { job_id: String(d.jobId ?? ''), kind: sanitizeText(d.kind, 32) });
    case 'job/settled':
      return makeEvent(meta, dshEvent, 'job_finished', {
        job_id: String(d.jobId ?? ''), status: sanitizeText(d.status, 32),
      });
    case 'session/title': {
      const title = sanitizeText(d.title, 80);
      return title ? makeEvent(meta, dshEvent, 'title', { title }) : null;
    }
    case 'subagent/catalog':
      return makeEvent(meta, dshEvent, 'subagent', { child_id: String(d.childId ?? ''), mode: sanitizeText(d.mode, 32) });
    case 'team/member':
      return makeEvent(meta, dshEvent, 'team', {
        kind: 'member', phase: sanitizeText(d.member && d.member.phase, 32),
        provider: sanitizeText(d.member && d.member.provider, 32),
      });
    case 'team/task':
      return makeEvent(meta, dshEvent, 'team', {
        kind: 'task', status: sanitizeText(d.task && d.task.status, 32),
      });
    case 'goal/change':
      return makeEvent(meta, dshEvent, 'goal', {
        kind: sanitizeText(d.kind, 32), phase: sanitizeText(d.goal && d.goal.phase, 32),
      });
    default:
      if (DSH_DIAGNOSTIC_TYPES.has(dshEvent.type)) {
        return makeEvent(meta, dshEvent, 'diagnostic', { kind: dshEvent.type });
      }
      return makeEvent(meta, dshEvent, 'unknown', { dsh_type: dshEvent.type });
  }
}

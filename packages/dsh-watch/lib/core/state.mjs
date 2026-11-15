// 状态机：纯函数，输入上一份 TaskSnapshot + 归一化事件，输出新快照。
// 规则依据 M0 结论（见 contract/README.md §2）：终态按 run 不可逆；工具报错不改变状态；等待窗口可离线判定。
import { TERMINAL_STATES, runIdFor } from './contract.mjs';
import { basenameSafe } from './redact.mjs';

const REASON_TO_STATE = {
  completed: 'succeeded',
  aborted: 'cancelled',
  error: 'failed',
  // DSH 源码另有 4 种 turn/end 原因（0.2.1-alpha.1 及第三方客户端实测确认）。
  // 语义依据：mimi-remote #861 收口表 + dsh-unstuck ABNORMAL_KINDS。
  'max-tokens': 'failed', // 单次输出触到上限，回复被截断 → 未完成
  blocked: 'failed', // 轮次前置检查拒绝继续
  interrupted: 'cancelled', // 旧格式迁移补写的未完成收尾
  forked: 'cancelled', // 分叉种子继承的未完成轮次
};

function clone(value) {
  return structuredClone(value);
}

function setState(snapshot, next) {
  if (snapshot.state === next) return false;
  snapshot.state = next;
  snapshot.state_version += 1;
  return true;
}

function emptyUsage() {
  return {
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
    cache_write_tokens: 0, total_tokens: 0, messages: 0,
  };
}

/**
 * 应用一条归一化事件。
 * @returns {{snapshot: object, state_changed: boolean}}
 */
export function applyEvent(prev, meta, event) {
  const s = clone(prev);
  s.updated_at = event.occurred_at;
  s.last_activity_at = event.occurred_at;
  const terminal = TERMINAL_STATES.has(s.state);
  let stateChanged = false;
  const change = (next) => { if (setState(s, next)) stateChanged = true; };

  switch (event.type) {
    case 'run_started': {
      const run = event.run_id || s.run_id;
      if (terminal || s.run_id !== run) {
        s.run_id = run;
        s.started_at = event.occurred_at;
        s.ended_at = null;
        s.waiting = null;
        s.current_step = null;
        s.current_tool = null;
        change('running');
        s.summary = '运行中';
      }
      break;
    }
    case 'step_started': {
      if (terminal) break;
      if (!s.run_id && event.run_id) {
        s.run_id = event.run_id;
        s.started_at = s.started_at ?? event.occurred_at;
        change('running');
      }
      s.current_step = Number.isInteger(event.payload.step) ? event.payload.step : s.current_step;
      s.summary = s.current_step != null ? '运行中 · 步骤 ' + s.current_step : '运行中';
      break;
    }
    case 'tool_started': {
      if (terminal) break;
      s.current_tool = event.payload.name || s.current_tool;
      if (event.payload.is_question) {
        s.waiting = {
          kind: 'input',
          since: event.occurred_at,
          call_id: event.payload.call_id || null,
          approval_id: null,
          tool_name: event.payload.name || null,
        };
        change('waiting_input');
        s.summary = '等待用户输入';
      } else {
        if (s.state === 'unknown') change('running');
        s.summary = s.current_tool ? '运行中 · ' + s.current_tool : '运行中';
      }
      break;
    }
    case 'tool_finished': {
      if (terminal) break;
      if (s.waiting && s.waiting.kind === 'input'
        && (!s.waiting.call_id || s.waiting.call_id === event.payload.call_id)) {
        s.waiting = null;
        change('running');
      }
      s.current_tool = null;
      s.summary = event.payload.is_error ? '运行中 · 工具报错（不改变终态）' : '运行中';
      if (s.state === 'unknown') change('running');
      break;
    }
    case 'assistant': {
      if (terminal) break;
      if (event.payload.usage) {
        const usage = s.token_usage ? { ...s.token_usage } : emptyUsage();
        usage.input_tokens += event.payload.usage.input_tokens || 0;
        usage.output_tokens += event.payload.usage.output_tokens || 0;
        usage.cache_read_tokens += event.payload.usage.cache_read_tokens || 0;
        usage.cache_write_tokens += event.payload.usage.cache_write_tokens || 0;
        usage.total_tokens += event.payload.usage.total_tokens || 0;
        usage.messages += 1;
        s.token_usage = usage;
      }
      if (s.state === 'unknown') change('running');
      break;
    }
    case 'approval_requested': {
      if (terminal) break;
      s.waiting = {
        kind: 'approval',
        since: event.occurred_at,
        call_id: event.payload.call_id || null,
        approval_id: event.payload.approval_id || null,
        tool_name: event.payload.tool_name || null,
      };
      change('waiting_approval');
      s.summary = '等待审批' + (s.waiting.tool_name ? ' · ' + s.waiting.tool_name : '');
      break;
    }
    case 'approval_decided': {
      if (terminal) break;
      if (s.waiting && s.waiting.kind === 'approval'
        && (!s.waiting.approval_id || s.waiting.approval_id === event.payload.approval_id)) {
        s.waiting = null;
        change('running');
        s.summary = '运行中';
      }
      break;
    }
    case 'run_finished': {
      const reason = event.payload.reason_kind;
      const next = REASON_TO_STATE[reason] || 'unknown';
      s.run_id = event.run_id || s.run_id;
      if (!terminal) {
        change(next);
        s.waiting = null;
        s.current_tool = null;
        if (next === 'unknown') {
          s.ended_at = null;
          s.summary = '未知终态（' + String(reason || '?') + '）';
        } else {
          s.ended_at = event.occurred_at;
          s.summary = next === 'succeeded' ? '已完成' : next === 'failed' ? '执行失败' : '已取消';
        }
      }
      break;
    }
    case 'user_message': {
      if (!terminal) {
        const fallbackTitle = basenameSafe(meta.cwd);
        if (event.payload.is_human && event.payload.title && (!s.title || s.title === fallbackTitle)) {
          s.title = event.payload.title;
        }
        s.summary = '收到用户消息';
      }
      break;
    }
    case 'title': {
      if (event.payload.title) s.title = event.payload.title;
      break;
    }
    case 'subagent': {
      s.agent_count += 1;
      break;
    }
    case 'team':
    case 'goal':
    case 'job_started':
    case 'job_finished':
    case 'diagnostic':
    case 'unknown':
    default:
      break;
  }

  if (!s.run_id && event.run_id) s.run_id = event.run_id;
  return { snapshot: s, state_changed: stateChanged };
}

/**
 * 实时事件（agent/status、agent/error、goal/changed）没有 seq、不落盘，只更新快照。
 * @param {object} prev
 * @param {'agent_status'|'agent_error'|'goal_changed'} kind
 * @param {object} payload
 * @param {number} at epoch ms
 */
export function applyLive(prev, kind, payload, at) {
  const s = clone(prev);
  s.updated_at = at;
  if (kind === 'agent_status') {
    const status = payload && payload.status;
    s.agent_state = status === 'running' ? 'running' : status === 'idle' ? 'idle' : 'unknown';
    if (s.agent_state === 'running' && s.state === 'unknown') {
      setState(s, 'running');
      s.summary = '运行中';
    }
  } else if (kind === 'agent_error') {
    if (!TERMINAL_STATES.has(s.state)) {
      setState(s, 'failed');
      s.ended_at = at;
      s.waiting = null;
      s.current_tool = null;
      s.summary = '执行失败';
    }
  }
  // goal_changed 只影响 goal 语义（M4 展示），不改变任务状态。
  return s;
}

/** 便捷：run_id 由 turn 计算（供外部工具使用）。 */
export function runIdOf(taskId, turn) {
  return runIdFor(taskId, turn);
}

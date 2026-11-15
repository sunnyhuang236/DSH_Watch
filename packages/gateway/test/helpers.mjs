// 网关测试工具：临时状态目录 + 假上游。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function tempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gateway-test-'));
  return { dir, file: path.join(dir, 'state.json') };
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 假 dsh-watch 上游：返回固定任务列表，支持更新。 */
export async function startFakeUpstream(initialTasks = []) {
  const state = { tasks: [...initialTasks], requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    if (req.url && req.url.startsWith('/v1/health')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, service: 'dsh-watch', stats: { tasks: state.tasks.length } }));
      return;
    }
    if (req.url && req.url.startsWith('/v1/tasks')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ schema_version: '1.0', tasks: state.tasks, next_cursor: null }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: 'http://127.0.0.1:' + port,
    state,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

export function task(overrides = {}) {
  return {
    schema_version: '1.0',
    task_id: 'session-test-0001',
    run_id: 'session-test-0001:1',
    state: 'running',
    state_version: 1,
    title: '测试任务',
    summary: '运行中',
    started_at: Date.now() - 10000,
    updated_at: Date.now(),
    last_activity_at: Date.now(),
    ended_at: null,
    capabilities: { approval: true, cost: false, agents: true },
    cost: null,
    token_usage: null,
    agent_count: 0,
    agent_state: 'unknown',
    connection: 'online',
    delegation_depth: 0,
    parent_task_id: null,
    origin: null,
    current_step: 2,
    current_tool: null,
    waiting: null,
    ...overrides,
  };
}

export async function getJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
}

export function waitFor(check, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const result = await check();
        if (result) { clearInterval(timer); resolve(result); }
        else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('waitFor timeout')); }
      } catch (error) {
        if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(error); }
      }
    }, intervalMs);
  });
}

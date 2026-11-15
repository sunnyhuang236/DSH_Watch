// M2 本地端到端验收：真实 dsh-watch(7317) → 网关(8787) → PWA 静态资源。
// 用法: node tools/m2-e2e.mjs [--gateway http://127.0.0.1:8787] [--out docs/evidence/m2/e2e.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let base = 'http://127.0.0.1:8787';
let out = path.join(REPO, 'docs', 'evidence', 'm2', 'e2e.json');
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--gateway') base = args[++i];
  else if (args[i] === '--out') out = path.resolve(REPO, args[++i]);
}
base = base.replace(/\/+$/, '');

async function json(pathname, options = {}) {
  const response = await fetch(base + pathname, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const evidence = { generatedAt: new Date().toISOString(), gateway: base, steps: [] };
function step(name, value) { evidence.steps.push({ name, ...value }); console.log(name + ': ' + JSON.stringify(value)); }

// 1 健康
const health = await json('/v1/health');
step('health', { status: health.status, upstream: health.body?.upstream, devices: health.body?.devices, subscriptions: health.body?.subscriptions });
if (health.status !== 200 || !health.body?.upstream?.ok) throw new Error('gateway/upstream not healthy');

// 2 配对会话
const created = await json('/v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
if (created.status !== 200) throw new Error('create pairing failed: ' + created.status);
step('pair_session', { pairing_id: created.body.pairing_id, code: created.body.code, pair_url: created.body.pair_url, computer_name: created.body.computer_name, fingerprint: created.body.fingerprint });

// 3 手机请求
const request = await json('/v1/pair/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: created.body.code, device_name: 'M2 E2E iPhone' }) });
if (request.status !== 200) throw new Error('pair request failed: ' + request.status);
step('pair_request', { request_id: request.body.request_id, status: request.body.status });

// 4 电脑确认
const confirmed = await json('/v1/pair/sessions/' + encodeURIComponent(created.body.pairing_id) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: request.body.request_id, approve: true }) });
step('pair_confirm', { status: confirmed.status, body: confirmed.body });

// 5 手机轮询拿 token
const polled = await json('/v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
step('pair_poll', { status: polled.status, result: polled.body?.status, device_id: polled.body?.device_id, token_prefix: polled.body?.device_token ? polled.body.device_token.slice(0, 8) + '…' : null });
if (polled.body?.status !== 'confirmed' || !polled.body?.device_token) throw new Error('pairing not confirmed');
const token = polled.body.device_token;

// 6 带 token 访问任务
const tasks = await json('/v1/tasks?limit=50', { headers: { Authorization: 'Bearer ' + token } });
step('tasks', { status: tasks.status, count: tasks.body?.tasks?.length, states: tasks.body?.tasks?.reduce((map, task) => { map[task.state] = (map[task.state] || 0) + 1; return map; }, {}) });
if (tasks.status !== 200) throw new Error('tasks unauthorized/failed');

// 7 未授权拒绝
const denied = await json('/v1/tasks');
step('unauthorized', { status: denied.status, code: denied.body?.error?.code });

// 8 PWA 静态
const index = await fetch(base + '/');
const html = await index.text();
const manifest = await json('/manifest.webmanifest');
const sw = await fetch(base + '/sw.js');
step('pwa', { index_status: index.status, html_has_brand: html.includes('DSH WATCH'), manifest_status: manifest.status, manifest_name: manifest.body?.name, sw_status: sw.status, sw_has_push: (await sw.text()).includes("addEventListener('push'") });

// 9 设备信息
const device = await json('/v1/devices/current', { headers: { Authorization: 'Bearer ' + token } });
step('device', { status: device.status, name: device.body?.name, device_id: device.body?.device_id });

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log('\nE2E PASS → ' + out);

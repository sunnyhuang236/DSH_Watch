// M2 PWA 截图：用 Chrome DevTools Protocol 注入配对 token，渲染任务列表/详情/设置/配对页。
// 前置：Chrome 需以 --remote-debugging-port=9223 启动。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(REPO, 'docs', 'evidence', 'panel');
const GATEWAY = process.env.M2_GATEWAY || 'http://127.0.0.1:8787';
const CDP = process.env.M2_CDP || 'http://127.0.0.1:9223';
fs.mkdirSync(OUT, { recursive: true });

async function json(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// 1) 走一遍真实配对，拿 token（不落盘）
const session = await json(GATEWAY + '/v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const request = await json(GATEWAY + '/v1/pair/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.body.code, device_name: 'M2 截图设备' }) });
await json(GATEWAY + '/v1/pair/sessions/' + encodeURIComponent(session.body.pairing_id) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: request.body.request_id, approve: true }) });
const paired = await json(GATEWAY + '/v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
if (!paired.body.device_token) throw new Error('pairing failed');
const token = paired.body.device_token;
const device = { device_id: paired.body.device_id, name: paired.body.device_name };

// 2) 连接页面 CDP
const pageList = await fetch(CDP + '/json/list').then((r) => r.json());
const page = pageList.find((item) => item.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
};
function call(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await call('Emulation.setTouchEmulationEnabled', { enabled: true });
await call('Page.navigate', { url: GATEWAY + '/' });
await sleep(1500);
await call('Runtime.evaluate', {
  expression: `localStorage.setItem('dsh_watch_token', ${JSON.stringify(token)}); localStorage.setItem('dsh_watch_device', ${JSON.stringify(JSON.stringify(device))}); localStorage.setItem('dsh_watch_device_name', 'M2 截图设备');`,
});

async function shot(name, hash, waitMs = 2500) {
  await call('Page.navigate', { url: GATEWAY + '/' + hash });
  await sleep(waitMs);
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  console.log('screenshot →', file);
}

await shot('m2-tasks.png', '#/tasks');
// 取一个任务看详情
const tasks = await json(GATEWAY + '/v1/tasks?limit=1', { headers: { Authorization: 'Bearer ' + token } });
if (tasks.body.tasks[0]) await shot('m2-detail.png', '#/task/' + encodeURIComponent(tasks.body.tasks[0].task_id));
await shot('m2-settings.png', '#/settings');
// 清 token 后看配对页
await call('Runtime.evaluate', { expression: "localStorage.removeItem('dsh_watch_token')" });
await shot('m2-pair.png', '#/pair', 2000);
ws.close();
console.log('done');

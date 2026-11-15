// V07 隧道 + PWA 安全上下文/安装前置检查（通过 Chrome DevTools Protocol）。
// 用法: node tools/m2-tunnel-check.mjs https://xxx.trycloudflare.com
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.argv[2];
if (!url) { console.error('usage: node m2-tunnel-check.mjs <https-url>'); process.exit(2); }
const CDP = process.env.M2_CDP || 'http://127.0.0.1:9224';
const OUT = path.join(REPO, 'docs', 'evidence', 'm2');
fs.mkdirSync(OUT, { recursive: true });

const pageList = await fetch(CDP + '/json/list').then((r) => r.json());
const page = pageList.find((item) => item.type === 'page');
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
await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await call('Emulation.setTouchEmulationEnabled', { enabled: true });
await call('Page.navigate', { url: url + '/pair' });
await sleep(3500);
const evaluated = await call('Runtime.evaluate', {
  expression: `(async () => {
    let sw = 'none';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      sw = reg ? 'registered:' + reg.scope : 'none';
    } catch (e) { sw = 'error:' + e.message; }
    const manifest = document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null;
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null;
    const standaloneMeta = document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content') || null;
    return JSON.stringify({
      href: location.href,
      isSecureContext: window.isSecureContext,
      sw,
      manifest,
      appleIcon,
      standaloneMeta,
      displayMode: matchMedia('(display-mode: standalone)').matches,
      viewport: window.innerWidth + 'x' + window.innerHeight
    });
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
const info = JSON.parse(evaluated.result.value);
const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const screenshot = path.join(REPO, 'docs', 'evidence', 'panel', 'm2-tunnel-pair.png');
fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
fs.writeFileSync(path.join(OUT, 'tunnel-check.json'), JSON.stringify({ url, checkedAt: new Date().toISOString(), info, screenshot: 'docs/evidence/panel/m2-tunnel-pair.png' }, null, 2));
console.log(JSON.stringify({ url, info, screenshot }, null, 2));
ws.close();

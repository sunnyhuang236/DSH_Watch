// dsh-watch-gateway HTTP 服务：配对、设备凭证、/v1 反代、PWA 静态托管、推送订阅。
// 设计：仅本机管理接口（配对会话创建/确认）要求 loopback；手机接口与 /v1 需要设备 Bearer token。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PairingManager } from './pairing.mjs';
import { PushService } from './push.mjs';
import { NotificationWatcher } from './notifier.mjs';
import { sha256 } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(HERE, '../../../apps/web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { code: 'body_too_large' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid json'), { code: 'invalid_json' })); }
    });
    req.on('error', reject);
  });
}

function isLoopback(req) {
  // cloudflared/反向代理会带 cf-connecting-ip / x-forwarded-for；这种请求一律不算本机管理请求。
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return false;
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function lanAddress() {
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  const alt = req.headers['x-device-token'];
  return typeof alt === 'string' ? alt.trim() : '';
}

/** 简单的固定窗口限流（内存）。 */
class RateLimiter {
  constructor({ windowMs = 60000, max = 60 } = {}) { this.windowMs = windowMs; this.max = max; this.map = new Map(); }
  hit(key) {
    const now = Date.now();
    const list = (this.map.get(key) || []).filter((at) => now - at < this.windowMs);
    if (list.length >= this.max) { this.map.set(key, list); return false; }
    list.push(now); this.map.set(key, list); return true;
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' || pathname === '/index.html' || pathname === '/pair' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('..')) { sendError(res, 400, 'bad_request', 'bad path'); return; }
  const file = path.join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA fallback（任务详情等深链由前端路由处理）
    if (!rel.includes('.')) return serveStatic(req, res, '/');
    sendError(res, 404, 'not_found', 'not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', ext === '.html' || rel === 'sw.js' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600');
  if (ext === '.html' || rel === 'sw.js') {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; manifest-src 'self'");
  }
  fs.createReadStream(file).pipe(res);
}

/**
 * 创建网关（不监听；测试可直接拿 request handler）。
 * @param {{store, upstream?: string, publicUrl?: string, logger?: any, startWatcher?: boolean, tls?: {key: Buffer, cert: Buffer}|null}} options
 */
export function createGateway({ store, upstream = 'http://127.0.0.1:7317', publicUrl = '', logger = null, startWatcher = true, tls = null }) {
  const pairing = new PairingManager();
  const push = new PushService({ store, logger });
  const watcher = new NotificationWatcher({ store, push, upstream, logger });
  const pairLimiter = new RateLimiter({ windowMs: 60000, max: 60 });
  let gatewayPort = 8787;

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    // ---- 静态 PWA ----
    if (method === 'GET' || method === 'HEAD') {
      if (!pathname.startsWith('/v1/') && !pathname.startsWith('/pair') || pathname === '/pair') {
        if (!pathname.startsWith('/v1/')) return serveStatic(req, res, pathname);
      }
      if (pathname === '/pair') return serveStatic(req, res, '/');
    }

    // ---- 健康 ----
    if (pathname === '/v1/health' && method === 'GET') {
      let upstreamOk = false;
      try {
        const response = await fetch(upstream + '/v1/health', { signal: AbortSignal.timeout(1500) });
        upstreamOk = response.ok;
      } catch { upstreamOk = false; }
      sendJson(res, 200, {
        ok: true,
        service: 'dsh-watch-gateway',
        version: '0.1.0',
        upstream: { ok: upstreamOk, url: upstream },
        public_url: store.getPublicUrl() || publicUrl || null,
        devices: store.listDevices().length,
        subscriptions: store.listSubscriptions().length,
        watcher: watcher.stats,
        retention_days: 30,
        time: Date.now(),
      });
      return;
    }

    // ---- 隧道地址登记（仅本机；tunnel.mjs 调用） ----
    if (pathname === '/v1/admin/tunnel-url' && method === 'POST') {
      if (!isLoopback(req)) { sendError(res, 403, 'forbidden', 'loopback-only'); return; }
      const body = await readBody(req);
      let url;
      try { url = new URL(String(body.url || '')); } catch { sendError(res, 400, 'bad_request', 'invalid url'); return; }
      if (url.protocol !== 'https:') { sendError(res, 400, 'bad_request', 'tunnel url must be https'); return; }
      store.setPublicUrl(url.origin);
      sendJson(res, 200, { ok: true, public_url: store.getPublicUrl() });
      return;
    }

    // ---- 地址变化后强制清空旧设备/订阅（仅本机） ----
    if (pathname === '/v1/admin/revoke-all' && method === 'POST') {
      if (!isLoopback(req)) { sendError(res, 403, 'forbidden', 'loopback-only'); return; }
      sendJson(res, 200, { ok: true, ...store.revokeAllDevices() });
      return;
    }

    // ---- 推送公钥 ----
    if (pathname === '/v1/push/public-key' && method === 'GET') {
      sendJson(res, 200, { public_key: push.publicKey });
      return;
    }

    // ---- 配对：创建会话（仅本机） ----
    if (pathname === '/v1/pair/sessions' && method === 'POST') {
      if (!isLoopback(req)) { sendError(res, 403, 'forbidden', 'pairing session creation is loopback-only'); return; }
      const session = pairing.createSession();
      const base = store.getPublicUrl() || publicUrl || ('http://' + lanAddress() + ':' + gatewayPort);
      sendJson(res, 200, {
        pairing_id: session.pairing_id,
        code: session.code,
        expires_at: session.expires_at,
        pair_url: base.replace(/\/+$/, '') + '/pair?p=' + encodeURIComponent(session.pairing_id) + '&code=' + session.code,
        computer_name: os.hostname(),
        fingerprint: sha256(os.hostname()).slice(0, 12),
      });
      return;
    }

    // ---- 配对：电脑查看/确认会话（仅本机） ----
    const sessionMatch = pathname.match(/^\/v1\/pair\/sessions\/([^/]+)$/);
    if (sessionMatch && method === 'GET') {
      if (!isLoopback(req)) { sendError(res, 403, 'forbidden', 'loopback-only'); return; }
      const session = pairing.getSession(decodeURIComponent(sessionMatch[1]));
      if (!session) { sendError(res, 404, 'not_found', 'pairing not found'); return; }
      const request = session.request_ids.length ? pairing.requests.get(session.request_ids[session.request_ids.length - 1]) : null;
      sendJson(res, 200, {
        pairing_id: session.pairing_id,
        status: session.status,
        expires_at: session.expires_at,
        request: request ? { request_id: request.request_id, device_name: request.device_name, status: request.status } : null,
      });
      return;
    }
    const confirmMatch = pathname.match(/^\/v1\/pair\/sessions\/([^/]+)\/confirm$/);
    if (confirmMatch && method === 'POST') {
      if (!isLoopback(req)) { sendError(res, 403, 'forbidden', 'loopback-only'); return; }
      const body = await readBody(req);
      const pairingId = decodeURIComponent(confirmMatch[1]);
      const requestId = String(body.request_id || '');
      const approve = body.approve !== false;
      const session = pairing.getSession(pairingId);
      if (!session) { sendError(res, 404, 'not_found', 'pairing not found'); return; }
      if (approve) {
        const deviceId = 'dev_' + crypto.randomBytes(8).toString('hex');
        const deviceToken = 'dsw_' + crypto.randomBytes(24).toString('base64url');
        store.addDevice({ deviceId, name: (pairing.requests.get(requestId) || {}).device_name || '未命名设备', tokenHash: sha256(deviceToken), pairingId });
        pairing.decide(pairingId, requestId, true, { deviceId, deviceToken });
        sendJson(res, 200, { status: 'confirmed', device: { device_id: deviceId, name: (pairing.requests.get(requestId) || {}).device_name } });
      } else {
        pairing.decide(pairingId, requestId, false);
        sendJson(res, 200, { status: 'rejected' });
      }
      return;
    }

    // ---- 配对：手机创建请求 ----
    if (pathname === '/v1/pair/requests' && method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!pairLimiter.hit('pair:' + ip)) { sendError(res, 429, 'rate_limited', 'too many pairing attempts'); return; }
      const body = await readBody(req);
      try {
        const request = pairing.createRequest({
          code: body.code ? String(body.code).replace(/\s+/g, '') : undefined,
          pairingId: body.pairing_id ? String(body.pairing_id) : undefined,
          deviceName: body.device_name,
        });
        sendJson(res, 200, {
          request_id: request.request_id,
          poll_token: request.poll_token,
          pairing_id: request.pairing_id,
          status: request.status,
          expires_at: pairing.getSession(request.pairing_id).expires_at,
        });
      } catch (error) {
        const code = error.code || 'pairing_error';
        const status = code === 'pairing_not_found' ? 404 : code === 'pairing_expired' ? 410 : code === 'too_many_requests' ? 429 : 400;
        sendError(res, status, code, error.message);
      }
      return;
    }

    // ---- 配对：手机轮询 ----
    const requestMatch = pathname.match(/^\/v1\/pair\/requests\/([^/]+)$/);
    if (requestMatch && method === 'GET') {
      const pollToken = url.searchParams.get('token') || '';
      const result = pairing.poll(decodeURIComponent(requestMatch[1]), pollToken);
      if (!result) { sendError(res, 404, 'not_found', 'request not found'); return; }
      sendJson(res, 200, result);
      return;
    }

    // ---- 以下均需设备凭证 ----
    if (pathname.startsWith('/v1/')) {
      const token = bearerToken(req);
      const device = store.findDeviceByToken(token);
      if (!device) { sendError(res, 401, 'unauthorized', 'missing or invalid device token'); return; }
      store.touchDevice(device);

      if (pathname === '/v1/devices/current' && method === 'GET') {
        sendJson(res, 200, {
          device_id: device.device_id, name: device.name,
          created_at: device.created_at, last_seen_at: device.last_seen_at, pairing_id: device.pairing_id,
        });
        return;
      }
      if (pathname === '/v1/devices/current' && method === 'DELETE') {
        store.revokeDevice(device.device_id);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (pathname === '/v1/push/subscribe' && method === 'POST') {
        const body = await readBody(req);
        try {
          store.upsertSubscription(device.device_id, body.subscription || {});
          sendJson(res, 200, { ok: true });
        } catch (error) { sendError(res, 400, 'bad_request', error.message); }
        return;
      }
      if (pathname === '/v1/push/unsubscribe' && method === 'POST') {
        const body = await readBody(req);
        store.removeSubscription(String(body.endpoint || ''), device.device_id);
        sendJson(res, 200, { ok: true });
        return;
      }

      // GET /v1/tasks* 反代到 dsh-watch
      if (method === 'GET' && (pathname === '/v1/tasks' || pathname.startsWith('/v1/tasks/'))) {
        try {
          const target = upstream + pathname + (url.search || '');
          const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
          const text = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(text);
        } catch (error) {
          sendError(res, 503, 'upstream_unavailable', 'dsh-watch upstream unavailable');
        }
        return;
      }
      sendError(res, 404, 'not_found', 'not found');
      return;
    }

    sendError(res, 404, 'not_found', 'not found');
  }

  const createServer = tls ? https.createServer.bind(https, tls) : http.createServer.bind(http);
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (logger && typeof logger.error === 'function') logger.error('[gateway] ' + error.message);
      if (!res.headersSent) sendError(res, 500, 'internal_error', 'internal error');
    });
  });

  return {
    server,
    pairing,
    push,
    watcher,
    store,
    setPort(port) { gatewayPort = port; },
    startWatcher: () => watcher.start(),
    stopWatcher: () => watcher.stop(),
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway } from '../lib/index.mjs';
import { tempStatePath, cleanup, startFakeUpstream, task, getJson } from './helpers.mjs';

async function setup({ tasks = [task()] } = {}) {
  const prev = tempStatePath();
  const upstream = await startFakeUpstream(tasks);
  const gateway = await startGateway({ port: 0, statePath: prev.file, upstream: upstream.url, watch: false });
  const base = gateway.url;
  return { prev, upstream, gateway, base };
}

async function teardown(ctx) {
  await ctx.gateway.close();
  await ctx.upstream.close();
  cleanup(ctx.prev.dir);
}

test('健康检查与推送公钥公开可读', async () => {
  const ctx = await setup();
  try {
    const health = await getJson(ctx.base + 'v1/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.service, 'dsh-watch-gateway');
    assert.equal(health.body.upstream.ok, true);
    const key = await getJson(ctx.base + 'v1/push/public-key');
    assert.equal(key.status, 200);
    assert.match(key.body.public_key, /^[A-Za-z0-9_-]{80,}$/);
  } finally { await teardown(ctx); }
});

test('完整配对：本机会话 → 手机请求 → 电脑确认 → 手机拿到 token → 可访问 /v1/tasks', async () => {
  const ctx = await setup();
  try {
    const session = await getJson(ctx.base + 'v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(session.status, 200);
    assert.match(session.body.code, /^\d{8}$/);
    assert.match(session.body.pair_url, /\/pair\?p=/);

    const request = await getJson(ctx.base + 'v1/pair/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: session.body.code, device_name: '测试 iPhone' }),
    });
    assert.equal(request.status, 200);
    assert.equal(request.body.status, 'pending');

    const pending = await getJson(ctx.base + 'v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
    assert.equal(pending.body.status, 'pending');

    const confirm = await getJson(ctx.base + 'v1/pair/sessions/' + encodeURIComponent(session.body.pairing_id) + '/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: request.body.request_id, approve: true }),
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.status, 'confirmed');

    const paired = await getJson(ctx.base + 'v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
    assert.equal(paired.body.status, 'confirmed');
    assert.ok(paired.body.device_token.startsWith('dsw_'));

    const unauthorized = await getJson(ctx.base + 'v1/tasks');
    assert.equal(unauthorized.status, 401);

    const tasks = await getJson(ctx.base + 'v1/tasks', { headers: { Authorization: 'Bearer ' + paired.body.device_token } });
    assert.equal(tasks.status, 200);
    assert.equal(tasks.body.tasks.length, 1);
    assert.equal(tasks.body.tasks[0].task_id, 'session-test-0001');

    const current = await getJson(ctx.base + 'v1/devices/current', { headers: { Authorization: 'Bearer ' + paired.body.device_token } });
    assert.equal(current.body.name, '测试 iPhone');
  } finally { await teardown(ctx); }
});

test('配对管理接口拒绝非 loopback（模拟 x-forwarded-for）', async () => {
  const ctx = await setup();
  try {
    const response = await getJson(ctx.base + 'v1/pair/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: '{}',
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'forbidden');
  } finally { await teardown(ctx); }
});

test('推送订阅：需要 token，订阅后可撤销；解除设备清掉订阅', async () => {
  const ctx = await setup();
  try {
    const session = await getJson(ctx.base + 'v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const request = await getJson(ctx.base + 'v1/pair/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.body.code, device_name: 'iPhone' }) });
    await getJson(ctx.base + 'v1/pair/sessions/' + encodeURIComponent(session.body.pairing_id) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: request.body.request_id, approve: true }) });
    const paired = await getJson(ctx.base + 'v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
    const auth = { Authorization: 'Bearer ' + paired.body.device_token, 'Content-Type': 'application/json' };

    const subscribe = await getJson(ctx.base + 'v1/push/subscribe', { method: 'POST', headers: auth, body: JSON.stringify({ subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'pk', auth: 'au' } } }) });
    assert.equal(subscribe.status, 200);
    assert.equal(ctx.gateway.store.listSubscriptions().length, 1);

    const unsubscribe = await getJson(ctx.base + 'v1/push/unsubscribe', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: 'https://push.example/1' }) });
    assert.equal(unsubscribe.status, 200);
    assert.equal(ctx.gateway.store.listSubscriptions().length, 0);

    const revoke = await getJson(ctx.base + 'v1/devices/current', { method: 'DELETE', headers: auth });
    assert.equal(revoke.status, 200);
    const after = await getJson(ctx.base + 'v1/tasks', { headers: auth });
    assert.equal(after.status, 401);
  } finally { await teardown(ctx); }
});

test('反代：上游不可用返回 503', async () => {
  const prev = tempStatePath();
  const gateway = await startGateway({ port: 0, statePath: prev.file, upstream: 'http://127.0.0.1:1', watch: false });
  try {
    const session = await getJson(gateway.url + 'v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const request = await getJson(gateway.url + 'v1/pair/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: session.body.code, device_name: 'iPhone' }) });
    await getJson(gateway.url + 'v1/pair/sessions/' + encodeURIComponent(session.body.pairing_id) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: request.body.request_id, approve: true }) });
    const paired = await getJson(gateway.url + 'v1/pair/requests/' + encodeURIComponent(request.body.request_id) + '?token=' + encodeURIComponent(request.body.poll_token));
    const tasks = await getJson(gateway.url + 'v1/tasks', { headers: { Authorization: 'Bearer ' + paired.body.device_token } });
    assert.equal(tasks.status, 503);
    assert.equal(tasks.body.error.code, 'upstream_unavailable');
  } finally { await gateway.close(); cleanup(prev.dir); }
});

test('隧道地址登记：loopback 可写，健康检查返回 public_url', async () => {
  const ctx = await setup();
  try {
    const set = await getJson(ctx.base + 'v1/admin/tunnel-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://demo.trycloudflare.com' }),
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.public_url, 'https://demo.trycloudflare.com');
    const health = await getJson(ctx.base + 'v1/health');
    assert.equal(health.body.public_url, 'https://demo.trycloudflare.com');

    const denied = await getJson(ctx.base + 'v1/admin/tunnel-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ url: 'https://evil.trycloudflare.com' }),
    });
    assert.equal(denied.status, 403);
  } finally { await teardown(ctx); }
});

test('PWA 静态资源可读：index/manifest/sw/app.js/icons', async () => {
  const ctx = await setup();
  try {
    for (const [path, type] of [['/', 'text/html'], ['/manifest.webmanifest', 'application/manifest\\+json'], ['/sw.js', 'text/javascript'], ['/app.js', 'text/javascript'], ['/icons/icon-192.png', 'image/png']]) {
      const response = await fetch(ctx.base + path.replace(/^\//, ''));
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') || '', new RegExp(type));
    }
    const html = await (await fetch(ctx.base)).text();
    assert.match(html, /DSH WATCH/);
    assert.match(html, /manifest.webmanifest/);
  } finally { await teardown(ctx); }
});

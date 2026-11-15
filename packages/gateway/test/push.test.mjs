import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as webpush from 'web-push';
import { GatewayStore } from '../lib/store.mjs';
import { PushService } from '../lib/push.mjs';
import { tempStatePath, cleanup } from './helpers.mjs';

function subscriptionFor(endpoint = 'https://push.example/1') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

test('Web Push 加密请求：VAPID Authorization + aes128gcm + 加密体（不联网）', () => {
  const subscription = subscriptionFor();
  const payload = { v: 1, kind: 'succeeded', task: 'session-x', event: 'session-x:1:succeeded' };
  const details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), { TTL: 300, urgency: 'high' });
  assert.match(details.headers.Authorization || '', /^vapid\s+t=/i);
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(details.body.length > 100, 'body should contain encrypted payload');
  assert.equal(details.body.includes('session-x'), false, 'payload must not appear in plaintext');
});

test('PushService：失败重试后成功；410 删除订阅', async () => {
  const { dir, file } = tempStatePath();
  try {
    const store = new GatewayStore({ path: file });
    store.addDevice({ deviceId: 'dev_push', name: 'iPhone', tokenHash: 'h' });
    store.upsertSubscription('dev_push', subscriptionFor('https://push.example/retry'));
    let attempts = 0;
    const retryPush = new PushService({
      store,
      maxAttempts: 3,
      retryDelays: [1, 1],
      sender: async () => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error('temporary'), { statusCode: 503 });
        return {};
      },
    });
    const result = await retryPush.sendToAll({ v: 1, kind: 'succeeded', task: 'session-x', event: 'e1' });
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.retried, 2);
    assert.equal(attempts, 3);

    store.removeSubscription('https://push.example/retry', 'dev_push');
    store.upsertSubscription('dev_push', subscriptionFor('https://push.example/gone'));
    const gonePush = new PushService({
      store,
      sender: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); },
    });
    const gone = await gonePush.sendToAll({ v: 1, kind: 'failed', task: 't', event: 'e2' });
    assert.equal(gone.failed, 0); // 410 视为失效订阅，不重复计为失败
    assert.equal(gone.removed, 1);
    assert.equal(store.listSubscriptions().some((item) => item.endpoint === 'https://push.example/gone'), false);
  } finally { cleanup(dir); }
});

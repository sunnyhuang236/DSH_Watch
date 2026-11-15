import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { GatewayStore } from '../lib/store.mjs';
import { tempStatePath, cleanup } from './helpers.mjs';

test('store：设备 token 只存哈希，撤销后不可查', () => {
  const { dir, file } = tempStatePath();
  try {
    const store = new GatewayStore({ path: file });
    const token = 'dsw_abc';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    store.addDevice({ deviceId: 'dev_2', name: 'iPad', tokenHash: hash });
    assert.equal(store.findDeviceByToken(token).device_id, 'dev_2');
    assert.equal(store.revokeDevice('dev_2'), true);
    assert.equal(store.findDeviceByToken(token), null);
    // 文件里没有明文 token
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes('dsw_abc'), false);
  } finally { cleanup(dir); }
});

test('store：VAPID 与推送订阅持久化', () => {
  const { dir, file } = tempStatePath();
  try {
    const store = new GatewayStore({ path: file });
    store.setVapid({ publicKey: 'pub', privateKey: 'priv' });
    store.addDevice({ deviceId: 'dev_1', name: 'iPhone', tokenHash: 'h' });
    store.upsertSubscription('dev_1', { endpoint: 'https://push.example/1', keys: { p256dh: 'pk', auth: 'au' } });
    const reloaded = new GatewayStore({ path: file });
    assert.equal(reloaded.getVapid().publicKey, 'pub');
    assert.equal(reloaded.listSubscriptions().length, 1);
    reloaded.removeSubscription('https://push.example/1', 'dev_1');
    assert.equal(reloaded.listSubscriptions().length, 0);
  } finally { cleanup(dir); }
});

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

test('store：deviceStats 区分有效/已撤销设备', () => {
  const { dir, file } = tempStatePath();
  try {
    const store = new GatewayStore({ path: file });
    store.addDevice({ deviceId: 'dev_a', name: 'A', tokenHash: 'ha' });
    store.addDevice({ deviceId: 'dev_b', name: 'B', tokenHash: 'hb' });
    assert.deepEqual(store.deviceStats(), { total: 2, revoked: 0, active: 2 });
    store.revokeDevice('dev_a');
    assert.deepEqual(store.deviceStats(), { total: 2, revoked: 1, active: 1 });
  } finally { cleanup(dir); }
});

test('store：public_url 变化会撤销旧设备并清空订阅', () => {
  const { dir, file } = tempStatePath();
  try {
    const store = new GatewayStore({ path: file });
    store.setPublicUrl('https://old.example');
    store.addDevice({ deviceId: 'dev_c', name: 'C', tokenHash: 'hc' });
    store.upsertSubscription('dev_c', { endpoint: 'https://push.example/c', keys: { p256dh: 'p', auth: 'a' } });
    assert.equal(store.deviceStats().active, 1);
    assert.equal(store.listSubscriptions().length, 1);
    store.setPublicUrl('https://new.example');
    assert.equal(store.deviceStats().active, 0);
    assert.equal(store.listSubscriptions().length, 0);
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

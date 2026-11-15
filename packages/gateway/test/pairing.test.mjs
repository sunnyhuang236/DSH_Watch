import test from 'node:test';
import assert from 'node:assert/strict';
import { PairingManager } from '../lib/pairing.mjs';

test('配对码：8 位数字、会话 5 分钟、唯一', () => {
  let now = 1_000_000;
  const manager = new PairingManager({ now: () => now });
  const a = manager.createSession();
  const b = manager.createSession();
  assert.match(a.code, /^\d{8}$/);
  assert.notEqual(a.code, b.code);
  assert.equal(a.expires_at - a.created_at, 5 * 60 * 1000);
  now = a.expires_at + 1;
  assert.equal(manager.getSession(a.pairing_id).status, 'expired');
});

test('手机请求 → 电脑确认 → 手机轮询拿到 token（只交付一次）', () => {
  const manager = new PairingManager();
  const session = manager.createSession();
  const request = manager.createRequest({ code: session.code, deviceName: 'iPhone 15' });
  assert.equal(request.status, 'pending');
  assert.equal(manager.poll(request.request_id, request.poll_token).status, 'pending');
  manager.decide(session.pairing_id, request.request_id, true, { deviceId: 'dev_1', deviceToken: 'dsw_token_1' });
  const first = manager.poll(request.request_id, request.poll_token);
  assert.equal(first.status, 'confirmed');
  assert.equal(first.device_token, 'dsw_token_1');
  const second = manager.poll(request.request_id, request.poll_token);
  assert.equal(second.device_token, null);
});

test('错误 poll_token 无法读取；拒绝后状态为 rejected', () => {
  const manager = new PairingManager();
  const session = manager.createSession();
  const request = manager.createRequest({ pairingId: session.pairing_id, deviceName: 'iPad' });
  assert.equal(manager.poll(request.request_id, 'wrong'), null);
  manager.decide(session.pairing_id, request.request_id, false);
  assert.equal(manager.poll(request.request_id, request.poll_token).status, 'rejected');
});

test('配对会话最多 5 个请求', () => {
  const manager = new PairingManager();
  const session = manager.createSession();
  for (let i = 0; i < 5; i += 1) manager.createRequest({ pairingId: session.pairing_id, deviceName: 'dev' + i });
  assert.throws(() => manager.createRequest({ pairingId: session.pairing_id, deviceName: 'dev5' }), /too many/);
});

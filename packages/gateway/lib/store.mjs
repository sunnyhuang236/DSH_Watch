// 网关本地状态：VAPID 密钥、设备凭证哈希、推送订阅、通知去重。
// 只写本机文件（默认 ~/.dsh/dsh-watch-gateway/state.json，权限尽量 0600）；token 只存哈希。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function defaultStatePath() {
  return path.join(os.homedir(), '.dsh', 'dsh-watch-gateway', 'state.json');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function emptyState() {
  return {
    version: 1,
    created_at: Date.now(),
    vapid: null,
    public_url: null,
    devices: [],
    subscriptions: [],
    notified: {},
  };
}

export class GatewayStore {
  /** @param {{path?: string}} [options] */
  constructor({ path: statePath = defaultStatePath() } = {}) {
    this.path = statePath;
    this.state = emptyState();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.path)) {
        const parsed = JSON.parse(fs.readFileSync(this.path, 'utf8'));
        if (parsed && parsed.version === 1) this.state = { ...emptyState(), ...parsed };
      }
    } catch { /* 损坏则重新开始，不阻塞网关启动 */ }
    this.state.devices ||= [];
    this.state.subscriptions ||= [];
    this.state.notified ||= {};
  }

  save() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.path);
    try { fs.chmodSync(this.path, 0o600); } catch { /* Windows 忽略 */ }
  }

  // ---- VAPID ----
  getVapid() { return this.state.vapid; }
  setVapid(vapid) { this.state.vapid = vapid; this.save(); }

  // ---- 当前公网/局域网访问地址（由 tunnel.mjs 或配置写入） ----
  getPublicUrl() { return this.state.public_url || null; }
  setPublicUrl(url) {
    const next = url ? String(url).replace(/\/+$/, '') : null;
    const previous = this.state.public_url || null;
    if (previous && next && previous !== next) {
      // 隧道地址变化后，旧 origin 的 PWA 设备与推送订阅全部失效，强制重新配对，避免幽灵通知。
      this.revokeAllDevices();
    }
    this.state.public_url = next;
    this.save();
  }

  revokeAllDevices() {
    let devices = 0;
    const now = Date.now();
    for (const device of this.state.devices) {
      if (!device.revoked_at) { device.revoked_at = now; devices += 1; }
    }
    const subscriptions = this.state.subscriptions.length;
    this.state.subscriptions = [];
    this.save();
    return { devices, subscriptions };
  }

  // ---- 设备 ----
  addDevice({ deviceId, name, tokenHash, pairingId }) {
    const device = {
      device_id: deviceId,
      name: String(name || '未命名设备').slice(0, 40),
      token_hash: tokenHash,
      pairing_id: pairingId || null,
      created_at: Date.now(),
      last_seen_at: null,
      revoked_at: null,
    };
    this.state.devices.push(device);
    this.save();
    return device;
  }

  findDeviceByToken(token) {
    if (!token) return null;
    const hash = sha256(token);
    const device = this.state.devices.find((item) => item.token_hash === hash && !item.revoked_at);
    return device || null;
  }

  getDevice(deviceId) {
    return this.state.devices.find((item) => item.device_id === deviceId && !item.revoked_at) || null;
  }

  touchDevice(device, at = Date.now()) {
    if (!device) return;
    if (!device.last_seen_at || at - device.last_seen_at > 30000) {
      device.last_seen_at = at;
      this.save();
    }
  }

  revokeDevice(deviceId) {
    const device = this.state.devices.find((item) => item.device_id === deviceId);
    if (!device) return false;
    device.revoked_at = Date.now();
    this.state.subscriptions = this.state.subscriptions.filter((item) => item.device_id !== deviceId);
    this.save();
    return true;
  }

  listDevices() {
    return this.state.devices.filter((item) => !item.revoked_at).map((item) => ({
      device_id: item.device_id, name: item.name, created_at: item.created_at, last_seen_at: item.last_seen_at,
    }));
  }

  // 设备统计：便于排查“为什么 devices 是 0”（旧隧道地址变化会撤销旧设备）
  deviceStats() {
    const total = this.state.devices.length;
    const revoked = this.state.devices.filter((item) => item.revoked_at).length;
    return { total, revoked, active: total - revoked };
  }

  // ---- 推送订阅 ----
  upsertSubscription(deviceId, subscription) {
    const endpoint = String(subscription.endpoint || '');
    const keys = subscription.keys || {};
    if (!endpoint || !keys.p256dh || !keys.auth) throw new Error('invalid subscription');
    const existing = this.state.subscriptions.find((item) => item.endpoint === endpoint);
    if (existing) {
      existing.device_id = deviceId;
      existing.keys = { p256dh: String(keys.p256dh), auth: String(keys.auth) };
      existing.updated_at = Date.now();
    } else {
      this.state.subscriptions.push({
        subscription_id: 'sub_' + crypto.randomBytes(8).toString('hex'),
        device_id: deviceId,
        endpoint,
        keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
    this.save();
  }

  removeSubscription(endpoint, deviceId = null) {
    const before = this.state.subscriptions.length;
    this.state.subscriptions = this.state.subscriptions.filter((item) => !(item.endpoint === endpoint && (!deviceId || item.device_id === deviceId)));
    if (this.state.subscriptions.length !== before) this.save();
  }

  listSubscriptions() { return [...this.state.subscriptions]; }

  // ---- 通知去重 ----
  wasNotified(key) { return Boolean(this.state.notified[key]); }
  markNotified(key, at = Date.now()) { this.state.notified[key] = at; this.pruneNotified(at); this.save(); }
  pruneNotified(now = Date.now()) {
    const cutoff = now - 7 * 24 * 3600 * 1000;
    for (const [key, at] of Object.entries(this.state.notified)) if (at < cutoff) delete this.state.notified[key];
  }
}

// 配对会话与手机请求（内存态；网关重启会清空未完成配对，符合短期一次性语义）。
import crypto from 'node:crypto';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_SESSION = 5;

function randomCode() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, '0');
}

function newId(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}

export class PairingManager {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.sessions = new Map(); // pairing_id -> session
    this.requests = new Map(); // request_id -> request
    this.byCode = new Map(); // code -> pairing_id
  }

  createSession() {
    let code = randomCode();
    while (this.byCode.has(code)) code = randomCode();
    const session = {
      pairing_id: newId('pair_'),
      code,
      created_at: this.now(),
      expires_at: this.now() + CODE_TTL_MS,
      status: 'pending', // pending | confirmed | rejected | expired
      attempts: 0,
      request_ids: [],
      confirmed_device: null,
    };
    this.sessions.set(session.pairing_id, session);
    this.byCode.set(code, session.pairing_id);
    return session;
  }

  getSession(pairingId) {
    const session = this.sessions.get(pairingId);
    if (!session) return null;
    if (session.status === 'pending' && session.expires_at <= this.now()) session.status = 'expired';
    return session;
  }

  findSessionByCode(code) {
    const id = this.byCode.get(String(code || ''));
    return id ? this.getSession(id) : null;
  }

  /** 手机创建配对请求（按 code 或 pairing_id）。 */
  createRequest({ code, pairingId, deviceName }) {
    const session = pairingId ? this.getSession(pairingId) : this.findSessionByCode(code);
    if (!session) throw Object.assign(new Error('pairing not found'), { code: 'pairing_not_found' });
    if (session.status !== 'pending') throw Object.assign(new Error('pairing ' + session.status), { code: 'pairing_' + session.status });
    if (session.request_ids.length >= MAX_REQUESTS_PER_SESSION) throw Object.assign(new Error('too many pairing requests'), { code: 'too_many_requests' });
    const request = {
      request_id: newId('req_'),
      pairing_id: session.pairing_id,
      poll_token: crypto.randomBytes(18).toString('base64url'),
      device_name: String(deviceName || '未命名设备').slice(0, 40),
      created_at: this.now(),
      status: 'pending', // pending | confirmed | rejected | expired
      device_id: null,
      device_token: null, // 只在第一次查询 confirmed 时返回
    };
    session.request_ids.push(request.request_id);
    this.requests.set(request.request_id, request);
    return request;
  }

  getRequest(requestId, pollToken) {
    const request = this.requests.get(String(requestId || ''));
    if (!request) return null;
    if (pollToken !== request.poll_token) return null;
    const session = this.getSession(request.pairing_id);
    if (request.status === 'pending' && (!session || session.status === 'expired')) request.status = 'expired';
    return request;
  }

  /** 电脑确认/拒绝一个手机请求。 */
  decide(pairingId, requestId, approve, { deviceId = null, deviceToken = null } = {}) {
    const session = this.getSession(pairingId);
    if (!session) throw Object.assign(new Error('pairing not found'), { code: 'pairing_not_found' });
    if (session.status === 'expired') throw Object.assign(new Error('pairing expired'), { code: 'pairing_expired' });
    const request = this.requests.get(String(requestId || ''));
    if (!request || request.pairing_id !== pairingId) throw Object.assign(new Error('request not found'), { code: 'request_not_found' });
    if (request.status !== 'pending') throw Object.assign(new Error('request already ' + request.status), { code: 'request_not_pending' });
    if (approve) {
      request.status = 'confirmed';
      request.device_id = deviceId;
      request.device_token = deviceToken;
      session.status = 'confirmed';
      session.confirmed_device = { device_id: deviceId, name: request.device_name };
    } else {
      request.status = 'rejected';
      session.status = 'rejected';
    }
    return request;
  }

  /** 手机轮询：返回状态；首次返回 confirmed 时交付 device_token，之后置空。 */
  poll(requestId, pollToken) {
    const request = this.getRequest(requestId, pollToken);
    if (!request) return null;
    const out = { status: request.status, pairing_id: request.pairing_id, device_name: request.device_name };
    if (request.status === 'confirmed') {
      out.device_id = request.device_id;
      out.device_token = request.device_token;
      request.device_token = null; // 只交付一次
    }
    return out;
  }
}

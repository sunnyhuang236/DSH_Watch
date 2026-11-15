// Web Push：VAPID 密钥、订阅发送、失效订阅清理。
// 使用 web-push（MIT）实现 RFC8291/8292；payload 只含不透明引用与 kind，不含标题/摘要。
import * as webpush from 'web-push';

const DEFAULT_SUBJECT = 'https://github.com/deepseek-ai/deepseek-harness';

export class PushService {
  /** @param {{store: import('./store.mjs').GatewayStore, subject?: string, logger?: any, sender?: Function, maxAttempts?: number, retryDelays?: number[]}} options */
  constructor({ store, subject = DEFAULT_SUBJECT, logger = null, sender = null, maxAttempts = 3, retryDelays = [300, 1200] }) {
    this.store = store;
    this.subject = subject;
    this.logger = logger;
    this.sender = sender || webpush.sendNotification;
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 3);
    this.retryDelays = Array.isArray(retryDelays) ? retryDelays : [300, 1200];
    this.ensureVapid();
  }

  ensureVapid() {
    let vapid = this.store.getVapid();
    if (!vapid || !vapid.publicKey || !vapid.privateKey) {
      const keys = webpush.generateVAPIDKeys();
      this.store.setVapid(keys);
      vapid = this.store.getVapid();
    }
    webpush.setVapidDetails(this.subject, vapid.publicKey, vapid.privateKey);
    this.publicKey = vapid.publicKey;
  }

  /** 发送给所有订阅；返回 {sent, failed, removed, retried}。 */
  async sendToAll(payload) {
    const subscriptions = this.store.listSubscriptions();
    let sent = 0;
    let failed = 0;
    let removed = 0;
    let retried = 0;
    for (const item of subscriptions) {
      let lastError = null;
      let delivered = false;
      let wasRemoved = false;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          await this.sender(
            { endpoint: item.endpoint, keys: { p256dh: item.keys.p256dh, auth: item.keys.auth } },
            JSON.stringify(payload),
            { TTL: 300, urgency: 'high' },
          );
          delivered = true;
          break;
        } catch (error) {
          lastError = error;
          const status = error && error.statusCode;
          if (status === 404 || status === 410) {
            this.store.removeSubscription(item.endpoint);
            removed += 1;
            wasRemoved = true;
            break;
          }
          if (attempt < this.maxAttempts) {
            retried += 1;
            const delay = this.retryDelays[Math.min(attempt - 1, this.retryDelays.length - 1)] || 300;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (delivered) sent += 1;
      else if (!wasRemoved) failed += 1;
      if (lastError && !delivered && this.logger && typeof this.logger.warn === 'function') {
        const status = lastError.statusCode;
        if (status !== 404 && status !== 410) this.logger.warn('[gateway] push failed (' + (status || lastError.message) + ')');
      }
    }
    return { sent, failed, removed, retried };
  }
}

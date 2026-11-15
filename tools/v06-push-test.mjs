// V06 传输层测试：用网关同一份 VAPID/订阅发送真实 Web Push（不经过 DSH 事件）。
// 用途：验证 iPhone 锁屏到达率；真实 DSH→push 链路由 M1 插件与网关 watcher 单测覆盖。
// 用法: node tools/v06-push-test.mjs [--count 20] [--interval 1500] [--state path] [--tag prefix]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GatewayStore, defaultStatePath } from '../packages/gateway/lib/store.mjs';
import { PushService } from '../packages/gateway/lib/push.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let count = 1;
let interval = 1500;
let statePath = defaultStatePath();
let tag = 'v06-' + Date.now();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--count') count = Number(args[++i]);
  else if (args[i] === '--interval') interval = Number(args[++i]);
  else if (args[i] === '--state') statePath = args[++i];
  else if (args[i] === '--tag') tag = args[++i];
}
const store = new GatewayStore({ path: statePath });
const push = new PushService({ store });
const kinds = ['succeeded', 'failed', 'waiting_input', 'waiting_approval', 'succeeded'];
const results = [];
for (let i = 1; i <= count; i += 1) {
  const kind = kinds[(i - 1) % kinds.length];
  const event = `${tag}:${i}:${kind}`;
  const started = Date.now();
  const result = await push.sendToAll({ v: 1, kind, task: tag, event, at: started });
  const row = { index: i, kind, event, result, ms: Date.now() - started, at: new Date().toISOString() };
  results.push(row);
  console.log(JSON.stringify(row));
  if (i < count) await new Promise((r) => setTimeout(r, interval));
}
const out = path.join(REPO, 'docs', 'evidence', 'm2', 'v06-push-test.json');
fs.writeFileSync(out, JSON.stringify({ tag, count, startedAt: results[0]?.at, finishedAt: results.at(-1)?.at, results }, null, 2));
console.log('EVIDENCE ' + out);

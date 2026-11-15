#!/usr/bin/env node
// 电脑端配对助手：生成 8 位配对码（附终端二维码），等待手机请求，按 y 确认。
// 用法: node bin/pair.mjs [--gateway http://127.0.0.1:8787]
import readline from 'node:readline/promises';
import * as QRCode from 'qrcode';

const args = process.argv.slice(2);
let base = 'http://127.0.0.1:8787';
for (let i = 0; i < args.length; i += 1) if (args[i] === '--gateway') base = args[++i];
base = base.replace(/\/+$/, '');

const created = await fetch(base + '/v1/pair/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
if (!created.ok) {
  console.error('创建配对会话失败：' + created.status + ' ' + (await created.text()));
  process.exit(1);
}
const session = await created.json();
console.log('');
console.log('  在手机上打开： ' + session.pair_url);
console.log('  备用 8 位码： ' + session.code);
console.log('  电脑名称：   ' + session.computer_name + '（指纹 ' + session.fingerprint + '）');
console.log('');
try {
  console.log(await QRCode.toString(session.pair_url, { type: 'terminal', small: true }));
} catch { /* 二维码失败时仍可用 8 位码 */ }
console.log('等待手机发起配对…');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let lastRequestId = null;
while (true) {
  const response = await fetch(base + '/v1/pair/sessions/' + encodeURIComponent(session.pairing_id));
  const status = await response.json();
  if (status.status === 'expired') { console.log('配对码已过期，请重试。'); break; }
  if (status.request && status.request.request_id !== lastRequestId) {
    lastRequestId = status.request.request_id;
    console.log('收到配对请求：' + status.request.device_name);
    const answer = (await rl.question('确认这是你的设备？(y/N) ')).trim().toLowerCase();
    const approve = answer === 'y' || answer === 'yes';
    const confirmed = await fetch(base + '/v1/pair/sessions/' + encodeURIComponent(session.pairing_id) + '/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: status.request.request_id, approve }),
    });
    console.log(approve ? '已确认，等手机完成配对。' : '已拒绝。');
    console.log(await confirmed.text());
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
rl.close();

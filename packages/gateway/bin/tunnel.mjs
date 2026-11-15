#!/usr/bin/env node
// 可选：启动 cloudflared 免费隧道（需 cloudflared 二进制；可自动使用 .data/bin/cloudflared.exe）。
// 用法: node bin/tunnel.mjs [--gateway http://127.0.0.1:8787] [--bin path]
// 说明：cloudflared 会输出一个 https://<随机>.trycloudflare.com 地址；把该地址填给手机。
// 这是 M2 的外部依赖项（V07），本仓库不自动下载二进制、不申请账号。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
let gateway = 'http://127.0.0.1:8787';
let bin = '';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--gateway') gateway = args[++i];
  else if (args[i] === '--bin') bin = args[++i];
}

function resolveBin() {
  if (bin) return bin;
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  const candidates = [
    path.join(REPO, '.data', 'bin', 'cloudflared.exe'),
    path.join(process.env.USERPROFILE || '', '.dsh', 'dsh-watch-gateway', 'bin', 'cloudflared.exe'),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return 'cloudflared';
}

const binary = resolveBin();
const found = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (found.error) {
  console.error('未找到 cloudflared。请先安装（零成本）：');
  console.error('  winget install --id Cloudflare.cloudflared');
  console.error('  或下载 cloudflared-windows-amd64.exe 到 .data/bin/cloudflared.exe');
  console.error('然后重试：node bin/tunnel.mjs --gateway ' + gateway);
  process.exit(1);
}
console.log('cloudflared: ' + String(found.stdout || found.stderr).trim());
console.log('启动隧道 → ' + gateway + '（地址会随机生成；按 Ctrl+C 结束）');
const child = spawn(binary, ['tunnel', '--url', gateway, '--no-autoupdate'], { stdio: ['inherit', 'pipe', 'pipe'] });
let reported = false;
let tail = '';
async function registerTunnel(url) {
  try {
    const response = await fetch(gateway.replace(/\/+$/, '') + '/v1/admin/tunnel-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) console.log('已登记到网关：' + body.public_url + '（手机可用此地址）');
    else console.log('登记隧道地址失败：' + response.status + ' ' + JSON.stringify(body));
  } catch (error) {
    console.log('登记隧道地址失败（网关未运行？）：' + error.message);
  }
}
function scan(chunk, stream) {
  stream.write(chunk);
  tail += chunk.toString();
  if (tail.length > 4000) tail = tail.slice(-4000);
  if (reported) return;
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(tail);
  if (match) { reported = true; void registerTunnel(match[0]); }
}
child.stdout.on('data', (chunk) => scan(chunk, process.stdout));
child.stderr.on('data', (chunk) => scan(chunk, process.stderr));
process.on('SIGINT', () => { child.kill('SIGINT'); process.exit(0); });
child.on('exit', (code) => process.exit(code ?? 0));

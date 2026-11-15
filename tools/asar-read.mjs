// 只读读取 Electron asar 包内文件（用于阅读本机 DSH 实现，不修改任何内容）。
// 用法:
//   node tools/asar-read.mjs list  <asar> <dirPath>          列出目录
//   node tools/asar-read.mjs cat   <asar> <filePath> [bytes] 读取文件（默认前 200000 字节）
//   node tools/asar-read.mjs grep  <asar> <filePath> <regex> 在单个文件内容中检索
import fs from 'node:fs';

const [action, asarPath, target, extra] = process.argv.slice(2);
if (!action || !asarPath) {
  console.error('usage: node tools/asar-read.mjs <list|cat|grep> <asar> <path> [extra]');
  process.exit(2);
}
const buf = fs.readFileSync(asarPath);
const JSON_SIZE = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + JSON_SIZE).toString('utf8'));
const dataOffset = 16 + JSON_SIZE;

function getNode(pathStr) {
  const parts = pathStr.split('/').filter(Boolean);
  let files = header.files;
  let node = null;
  for (const part of parts) {
    node = files[part];
    if (!node) return null;
    files = node.files || {};
  }
  return node;
}

if (action === 'list') {
  const node = getNode(target || '');
  if (!node || !node.files) { console.error('directory not found:', target); process.exit(1); }
  for (const [name, child] of Object.entries(node.files)) {
    if (child.files) console.log('d ' + name);
    else console.log('f ' + String(child.size).padStart(10) + '  ' + name);
  }
} else if (action === 'cat' || action === 'grep') {
  const node = getNode(target);
  if (!node || node.files) { console.error('file not found:', target); process.exit(1); }
  const start = dataOffset + Number(node.offset);
  const raw = buf.subarray(start, start + Number(node.size));
  if (action === 'cat') {
    const n = extra ? Number(extra) : 200000;
    process.stdout.write(raw.subarray(0, n).toString('utf8'));
    if (raw.length > n) console.log('\n... [truncated ' + (raw.length - n) + ' bytes]');
  } else {
    const re = new RegExp(extra || '');
    const text = raw.toString('utf8');
    const lines = text.split('\n');
    let hits = 0;
    lines.forEach((line, i) => {
      if (re.test(line)) { console.log((i + 1) + ': ' + line.slice(0, 400)); hits += 1; }
    });
    console.log('hits=' + hits + ' lines=' + lines.length);
  }
} else {
  console.error('unknown action', action);
  process.exit(2);
}

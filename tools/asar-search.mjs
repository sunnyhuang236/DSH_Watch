// 在 app.asar 内全量检索文本（只读，用于寻找上游测试/fixture 中的事件样例）。
// 用法: node tools/asar-search.mjs <regex> [pathPrefix] [maxHits]
import fs from 'node:fs';

const [pattern, prefix = '', maxHitsArg = '40'] = process.argv.slice(2);
if (!pattern) {
  console.error('usage: node tools/asar-search.mjs <regex> [pathPrefix] [maxHits]');
  process.exit(2);
}
const re = new RegExp(pattern);
const MAX_HITS = Number(maxHitsArg) || 40;
const ASAR = 'D:/DeepSeek Harness/resources/app.asar';
const buf = fs.readFileSync(ASAR);
const JSON_SIZE = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + JSON_SIZE).toString('utf8'));
const dataOffset = 16 + JSON_SIZE;

let hits = 0;
let scannedFiles = 0;
let scannedBytes = 0;

function walk(node, pathParts) {
  if (hits >= MAX_HITS) return;
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, pathParts.concat(name));
    return;
  }
  const fullPath = pathParts.join('/');
  if (prefix && !fullPath.startsWith(prefix)) return;
  if (!/\.(m?js|cjs|json|yaml|yml|md|txt)$/.test(fullPath)) return;
  const size = Number(node.size) || 0;
  scannedFiles += 1;
  scannedBytes += size;
  const start = dataOffset + Number(node.offset);
  const text = buf.subarray(start, start + size).toString('utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && hits < MAX_HITS; i += 1) {
    if (re.test(lines[i])) {
      hits += 1;
      console.log(fullPath + ':' + (i + 1) + ': ' + lines[i].slice(0, 300));
    }
  }
}
walk(header.files, []);
console.error(`\nscan: files=${scannedFiles} bytes=${scannedBytes} hits=${hits}${hits >= MAX_HITS ? ' (truncated)' : ''}`);

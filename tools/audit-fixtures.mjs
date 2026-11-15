// 脱敏审计（M1）：递归检查 fixtures/ 是否残留敏感信息，并做基础 schema/顺序检查。
// 用法: node tools/audit-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX_DIR = path.join(REPO, 'fixtures');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const SESS = path.join(HOME, '.dsh', 'sessions');
const OUT_TXT = path.join(REPO, 'docs', 'evidence', 'fixture-audit.txt');
const OUT_JSON = path.join(REPO, 'docs', 'evidence', 'fixture-audit.json');

function walk(dir, ext, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, acc);
    else if (entry.isFile() && entry.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

// 从本机会话收集原始 ID / 目录名作为禁止出现的字符串（只读）。
const forbidden = new Set(['22472', 'AppData', 'USERPROFILE']);
for (const file of walk(SESS, '.zstd')) {
  try {
    const records = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (records[0] && records[0].id) forbidden.add(String(records[0].id));
    const parts = file.split(path.sep);
    const idx = parts.indexOf('sessions');
    if (idx >= 0 && parts[idx + 1]) forbidden.add(parts[idx + 1]);
  } catch { /* ignore */ }
}

const PATTERNS = [
  { name: 'windows-drive-path', re: /[A-Za-z]:[\\/]/ },
  { name: 'posix-home-path', re: /\/c\/Users|\/home\/|\/Users\// },
  { name: 'url', re: /https?:\/\/|wss?:\/\//i },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'token-prefix', re: /\b(sk-|ghp_|github_pat_|AKIA|xox[baprs]-|Bearer\s)/i },
  { name: 'jwt-like', re: /eyJ[A-Za-z0-9_-]{10,}/ },
  { name: 'secret-word', re: /password|passwd|secret|api[_-]?key|token\s*[:=]|private[_-]?key/i },
  { name: 'cjk', re: /[\u4e00-\u9fff]/ },
  { name: 'long-base64', re: /[A-Za-z0-9+/]{120,}={0,2}/ },
];

const violations = [];
const report = [];
const files = walk(FIX_DIR, '.jsonl').sort();
for (const file of files) {
  const rel = path.relative(REPO, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  report.push({ file: rel, lines: lines.length, bytes: fs.statSync(file).size });
  lines.forEach((line, index) => {
    let record;
    try { record = JSON.parse(line); } catch { violations.push({ file: rel, line: index + 1, rule: 'json-parse' }); return; }
    if (index === 0 && record.type !== 'session') violations.push({ file: rel, line: 1, rule: 'header' });
    if (index > 0 && (typeof record.seq !== 'number' || typeof record.time !== 'number' || !record.data)) {
      violations.push({ file: rel, line: index + 1, rule: 'schema' });
    }
    if (/[^\x00-\x7F]/.test(line)) violations.push({ file: rel, line: index + 1, rule: 'non-ascii' });
    for (const pattern of PATTERNS) if (pattern.re.test(line)) violations.push({ file: rel, line: index + 1, rule: pattern.name });
    for (const bad of forbidden) if (bad.length >= 6 && line.includes(bad)) violations.push({ file: rel, line: index + 1, rule: 'forbidden-original-string' });
    const walkStrings = (value, p) => {
      if (typeof value === 'string') { if (value.length > 200) violations.push({ file: rel, line: index + 1, rule: 'long-string', detail: p + ' len=' + value.length }); }
      else if (Array.isArray(value)) value.forEach((item) => walkStrings(item, p + '[]'));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, p + '.' + k);
    };
    walkStrings(record.data, 'data');
  });
  const records = lines.map((line) => JSON.parse(line)).slice(1);
  records.forEach((record, index) => {
    if (record.seq !== index) violations.push({ file: rel, line: 2 + index, rule: 'seq-not-contiguous', detail: 'expected ' + index + ' got ' + record.seq });
  });
}

const summary = { generatedAt: new Date().toISOString(), checkedFiles: files.length, checkedLines: report.reduce((sum, item) => sum + item.lines, 0), violations, files: report };
fs.mkdirSync(path.dirname(OUT_TXT), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1));
const out = ['fixtures audit ' + summary.generatedAt];
for (const item of report) out.push('  ' + item.file + ': lines=' + item.lines + ' bytes=' + item.bytes);
out.push('checkedFiles=' + summary.checkedFiles + ' checkedLines=' + summary.checkedLines + ' violations=' + violations.length);
for (const violation of violations.slice(0, 50)) out.push('  VIOLATION ' + violation.file + ':' + violation.line + ' [' + violation.rule + '] ' + (violation.detail || ''));
fs.writeFileSync(OUT_TXT, out.join('\n') + '\n');
console.log(out.join('\n'));
console.log('AUDIT ' + (violations.length === 0 ? 'PASS' : 'FAIL'));
process.exit(violations.length === 0 ? 0 : 1);

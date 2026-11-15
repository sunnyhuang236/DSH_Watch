// 只读回放工具：把本机 DSH 会话日志（或 M0 fixtures）回放进 M1 管道，
// 写本机 SQLite 并启动只读 /v1 API + 调试面板（不需要安装插件）。
//
// 用法:
//   node tools/replay-logs.mjs                    # 回放 ~/.dsh/sessions 最近 8 个会话
//   node tools/replay-logs.mjs --all              # 回放全部会话
//   node tools/replay-logs.mjs --fixtures         # 回放 fixtures/ 下脱敏样本
//   node tools/replay-logs.mjs --limit 20 --port 7317 --db .data/watch.db
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WatchStore } from '../packages/dsh-watch/lib/core/store.mjs';
import { Ingestor } from '../packages/dsh-watch/lib/core/pipeline.mjs';
import { sessionMeta } from '../packages/dsh-watch/lib/core/normalize.mjs';
import { startApi } from '../packages/dsh-watch/lib/api.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    sessionsDir: path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'sessions'),
    db: path.join(REPO, '.data', 'watch.db'),
    host: '127.0.0.1',
    port: 7317,
    limit: 8,
    all: false,
    fixtures: false,
    serve: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.all = true;
    else if (arg === '--fixtures') options.fixtures = true;
    else if (arg === '--no-serve') options.serve = false;
    else if (arg === '--sessions') options.sessionsDir = argv[++i];
    else if (arg === '--db') options.db = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').slice(0, 900)); process.exit(0); }
  }
  return options;
}

const sha8 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);

function walkSessions(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSessions(full, acc);
    else if (entry.isFile() && /session\.v\d+\.jsonl\.zstd$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function readSessionLog(file) {
  const raw = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8');
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const header = records[0];
  const events = header && header.type === 'session' ? records.slice(1) : records;
  return { header, events };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const store = new WatchStore({ path: options.db });
  const ingestor = new Ingestor({ store });
  const rows = [];

  if (options.fixtures) {
    const dir = path.join(REPO, 'fixtures');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort();
    for (const name of files) {
      const file = path.join(dir, name);
      const { header, events } = readSessionLog(file);
      const meta = sessionMeta(header);
      const applied = ingestor.ingestSessionEvents(meta, events);
      const snapshot = store.getTask(meta.task_id);
      rows.push({ source: 'fixture:' + name, sessionId: meta.task_id, depth: meta.delegation_depth, applied, state: snapshot ? snapshot.state : null, summary: snapshot ? snapshot.summary : null });
    }
  } else {
    const files = walkSessions(options.sessionsDir)
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const selected = options.all ? files : files.slice(0, options.limit);
    for (const entry of selected) {
      try {
        const { header, events } = readSessionLog(entry.file);
        const meta = sessionMeta(header);
        if (!meta.task_id) continue;
        const applied = ingestor.ingestSessionEvents(meta, events);
        const snapshot = store.getTask(meta.task_id);
        rows.push({ source: 'log:' + sha8(meta.task_id), sessionId: meta.task_id, depth: meta.delegation_depth, applied, state: snapshot ? snapshot.state : null, summary: snapshot ? snapshot.summary : null });
      } catch (error) {
        rows.push({ source: 'log:' + path.basename(path.dirname(path.dirname(entry.file))), error: error.message });
      }
    }
  }

  console.log('回放完成：' + rows.length + ' 个会话写入 ' + options.db);
  for (const row of rows) {
    console.log('  ' + row.source + ' depth=' + row.depth + ' applied=' + row.applied + ' state=' + row.state + ' summary=' + row.summary + (row.error ? ' ERROR=' + row.error : ''));
  }
  console.log('stats=' + JSON.stringify(ingestor.stats) + ' store=' + JSON.stringify(store.stats()));

  if (!options.serve) { store.close(); return; }
  const api = await startApi({ store, host: options.host, port: options.port });
  console.log('\n调试面板: ' + api.url);
  console.log('只读 API : ' + api.url + 'v1/health | /v1/tasks | /v1/tasks/{id}/events');
  console.log('按 Ctrl+C 退出（只读，无外网）。');
  const shutdown = async () => {
    console.log('\n关闭…');
    await api.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => { console.error(error); process.exit(1); });

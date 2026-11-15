// 只读 tail 工具：轮询 ~/.dsh/sessions 下的会话日志，增量解压新增 zstd 帧，
// 近实时喂给 M1 管道（无需安装插件即可在浏览器看真实运行中的 DSH 任务）。
//
// 用法:
//   node tools/watch-logs.mjs                         # 默认 500ms 轮询、端口 7317
//   node tools/watch-logs.mjs --interval 1000 --port 7317 --db .data/watch.db
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
    intervalMs: 500,
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--sessions') options.sessionsDir = argv[++i];
    else if (arg === '--db') options.db = argv[++i];
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--interval') options.intervalMs = Math.max(100, Number(argv[++i]) || 500);
    else if (arg === '--once') options.once = true;
  }
  return options;
}

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

/** 每个日志文件的增量解压状态。 */
function newFileState() {
  return { compressedOffset: 0, pending: Buffer.alloc(0), lineBuffer: '', header: null, warnings: 0 };
}

function processDecoded(fsState, text, ingestor) {
  const combined = fsState.lineBuffer + text;
  const lines = combined.split('\n');
  fsState.lineBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!fsState.header) {
      if (record && record.type === 'session') { fsState.header = record; continue; }
      if (record && typeof record.seq === 'number') {
        // 极端情况下丢失 header：按独立任务处理不了，跳过并告警一次。
        if (fsState.warnings < 3) { console.warn('watch: missing session header, skipping event'); fsState.warnings += 1; }
        continue;
      }
      continue;
    }
    if (record && typeof record.seq === 'number') ingestor.ingest(sessionMeta(fsState.header), record);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const store = new WatchStore({ path: options.db });
  const ingestor = new Ingestor({ store });
  const files = new Map();
  let initialPass = true;
  let running = true;

  const tick = () => {
    const discovered = walkSessions(options.sessionsDir);
    for (const file of discovered) {
      if (!files.has(file)) files.set(file, newFileState());
      const state = files.get(file);
      let stat;
      try { stat = fs.statSync(file); } catch { continue; }
      if (stat.size <= state.compressedOffset) continue;
      let chunk;
      try {
        const fd = fs.openSync(file, 'r');
        chunk = Buffer.alloc(stat.size - state.compressedOffset);
        fs.readSync(fd, chunk, 0, chunk.length, state.compressedOffset);
        fs.closeSync(fd);
      } catch (error) {
        console.warn('watch: read failed ' + file + ': ' + error.message);
        continue;
      }
      state.compressedOffset = stat.size;
      state.pending = Buffer.concat([state.pending, chunk]);
      try {
        const decoded = zlib.zstdDecompressSync(state.pending);
        state.pending = Buffer.alloc(0);
        processDecoded(state, decoded.toString('utf8'), ingestor);
      } catch {
        // 末尾可能是半帧，等下一次轮询继续拼接；超过 8MB 视为异常丢弃，避免内存泄漏。
        if (state.pending.length > 8 * 1024 * 1024) {
          console.warn('watch: drop pending bytes for ' + file + ' (too large)');
          state.pending = Buffer.alloc(0);
        }
      }
    }
    if (initialPass) {
      initialPass = false;
      console.log('首次扫描完成：' + files.size + ' 个会话日志；stats=' + JSON.stringify(ingestor.stats));
    }
  };

  tick();
  const timer = setInterval(tick, options.intervalMs);
  const api = await startApi({ store, host: options.host, port: options.port });
  console.log('近实时面板: ' + api.url + '（每 ' + options.intervalMs + 'ms 轮询，只读）');
  console.log('按 Ctrl+C 退出。');
  if (options.once) {
    clearInterval(timer);
    await api.close();
    store.close();
    return;
  }
  const shutdown = async () => {
    running = false;
    clearInterval(timer);
    console.log('\n关闭… stats=' + JSON.stringify(ingestor.stats) + ' store=' + JSON.stringify(store.stats()));
    await api.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  void running;
}

main().catch((error) => { console.error(error); process.exit(1); });

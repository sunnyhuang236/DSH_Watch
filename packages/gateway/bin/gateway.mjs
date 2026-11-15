#!/usr/bin/env node
// 启动 M2 网关。
// 用法:
//   node bin/gateway.mjs [--port 8787] [--host 127.0.0.1] [--upstream http://127.0.0.1:7317]
//                         [--state ~/.dsh/dsh-watch-gateway/state.json] [--public-url http://192.168.x.x:8787]
//                         [--tls-cert cert.pem --tls-key key.pem] [--no-watch]
import { startGateway } from '../lib/index.mjs';

function parseArgs(argv) {
  const options = { host: '127.0.0.1', port: 8787 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--upstream') options.upstream = argv[++i];
    else if (arg === '--state') options.statePath = argv[++i];
    else if (arg === '--public-url') options.publicUrl = argv[++i];
    else if (arg === '--tls-cert') options.tlsCert = argv[++i];
    else if (arg === '--tls-key') options.tlsKey = argv[++i];
    else if (arg === '--no-watch') options.watch = false;
    else if (arg === '--help' || arg === '-h') { console.log('dsh-watch-gateway: node bin/gateway.mjs [--port 8787] [--host 127.0.0.1] [--upstream URL] [--public-url URL] [--tls-cert file --tls-key file]'); process.exit(0); }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const gateway = await startGateway(options);
console.log('DSH Watch Gateway: ' + gateway.url);
console.log('  PWA:      ' + gateway.url + '  (配对页 ' + gateway.url + 'pair)');
console.log('  上游:     ' + (options.upstream || 'http://127.0.0.1:7317'));
console.log('  状态文件: ' + (options.statePath || '~/.dsh/dsh-watch-gateway/state.json'));
console.log('  按 Ctrl+C 退出。');
const shutdown = async () => { console.log('\n关闭…'); await gateway.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

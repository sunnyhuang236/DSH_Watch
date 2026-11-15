// 网关启动入口。
import fs from 'node:fs';
import { GatewayStore, defaultStatePath } from './store.mjs';
import { createGateway } from './server.mjs';

/**
 * @param {{host?: string, port?: number, upstream?: string, statePath?: string, publicUrl?: string, logger?: any, watch?: boolean,
 *          tlsCert?: string, tlsKey?: string}} [options]
 */
export async function startGateway(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number.isFinite(options.port) ? options.port : 8787;
  let tls = null;
  if (options.tlsCert && options.tlsKey) {
    tls = { cert: fs.readFileSync(options.tlsCert), key: fs.readFileSync(options.tlsKey) };
  }
  const store = new GatewayStore({ path: options.statePath || defaultStatePath() });
  const gateway = createGateway({
    store,
    upstream: options.upstream || 'http://127.0.0.1:7317',
    publicUrl: options.publicUrl || '',
    logger: options.logger || console,
    startWatcher: options.watch !== false,
    tls,
  });
  gateway.setPort(port);
  await new Promise((resolve, reject) => {
    const onError = (error) => { gateway.server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { gateway.server.removeListener('error', onError); resolve(); };
    gateway.server.once('error', onError);
    gateway.server.once('listening', onListening);
    gateway.server.listen(port, host);
  });
  const actualPort = gateway.server.address().port;
  gateway.setPort(actualPort);
  if (options.watch !== false) gateway.startWatcher();
  return {
    ...gateway,
    host,
    port: actualPort,
    protocol: tls ? 'https' : 'http',
    url: (tls ? 'https' : 'http') + '://' + host + ':' + actualPort + '/',
    async close() {
      gateway.stopWatcher();
      await new Promise((resolve) => {
        gateway.server.close(() => resolve());
        if (typeof gateway.server.closeAllConnections === 'function') gateway.server.closeAllConnections();
      });
    },
  };
}

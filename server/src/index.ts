import './env.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { initDb, getDb, getSetting } from './db/index.js';
import { startHealthChecker, startDailyKeyCheck } from './services/health.js';
import { applyProxyUrl, applyProxyEnabled, applyProxyBypass } from './lib/proxy.js';
import { startCatalogSync } from './services/catalog-sync.js';
import { installProcessSafetyNet } from './lib/process-safety-net.js';
import { NodeScheduler } from './lib/scheduler.js';
import { loadConfig } from './lib/config.js';
import { applyDeclarativeConfigFromEnv } from './services/declarative-config.js';
import { restoreDbBackupIfNeeded, startDbBackupPump } from './lib/db-backup.js';
import { userCount } from './services/auth.js';
import { generateSetupCode } from './lib/setup-code.js';
import { warnOnEnvDrift } from './lib/env-drift.js';

async function main() {
  const config = loadConfig();
  const { port: PORT, host: HOST } = config;
  warnOnEnvDrift();

  // Install first so a late provider socket reset (undici HTTP/2 error with no
  // listener) can't take the proxy down. Genuine bugs still exit 1.
  installProcessSafetyNet();

  const scheduler = new NodeScheduler();

  if (config.dbPath) {
    await restoreDbBackupIfNeeded(config.dbPath);
  } else {
    await restoreDbBackupIfNeeded();
  }
  initDb(config.dbPath ?? undefined);
  applyDeclarativeConfigFromEnv();

  // First-run hardening: when the dashboard is still unclaimed, mint a one-time
  // setup code and log it. A loopback browser can finish setup without it; a
  // remote caller must supply it (see routes/auth.ts). Regenerated each boot.
  if (userCount() === 0) {
    generateSetupCode();
  }

  // Load the persisted proxy settings from the DB (env var wins if set).
  // Must happen after initDb so the settings table is ready.
  applyProxyUrl(getSetting('proxy_url') ?? '');
  applyProxyEnabled(getSetting('proxy_enabled') !== '0'); // default: enabled
  applyProxyBypass(getSetting('proxy_bypass') ?? '');

  // App with static files (admin panel)
  const app = createApp(config);
  // API-only app (no static files) for port separation
  const apiApp = createApp({ ...config, serveStaticAssets: false });

  const onReady = (label: string) => (host: string) => () => {
    const display = host.includes(':') ? `[${host}]` : host;
    const port = label === 'api' ? PORT : (label === 'admin' ? 3002 : PORT);
    console.log(`${label === 'api' ? 'API server' : label === 'admin' ? 'Admin panel' : 'Server'} running on http://${display}:${port}`);
    if (label !== 'admin') {
      console.log(`Proxy endpoint: http://${display}:${port}/v1/chat/completions`);
    }
    startHealthChecker(scheduler);
    startCatalogSync(scheduler);
    startDbBackupPump(getDb(), scheduler, config.dbPath ?? undefined);
    if (getSetting('auto_key_check') === '1') {
      startDailyKeyCheck(scheduler);
    }
  };

  const handleServerError = (err: NodeJS.ErrnoException, fallbackPort?: number | string, fallbackLabel?: string) => {
    if (!process.env.HOST && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
      console.warn('[server] IPv6 unavailable on this host — falling back to 0.0.0.0 (IPv4-only)');
      app.listen(Number(fallbackPort ?? PORT), '0.0.0.0', onReady(fallbackLabel ?? 'main')('0.0.0.0'));
      return;
    }
    console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
    process.exit(1);
  };

  if (getSetting('admin_port_separation') === '1') {
    const ADMIN_PORT = 3002;

    // Port 3001: API only (no static files)
    const apiServer = apiApp.listen(Number(PORT), HOST, onReady('api')(HOST));
    apiServer.on('error', (err: NodeJS.ErrnoException) => handleServerError(err, PORT, 'api'));

    // Port 3002: Admin panel with static files
    const adminServer = app.listen(ADMIN_PORT, HOST, () => {
      const display = HOST.includes(':') ? `[${HOST}]` : HOST;
      console.log(`Admin panel on http://${display}:${ADMIN_PORT}`);
    });
    adminServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[admin] Port ${ADMIN_PORT} in use — admin panel only available on port ${PORT}`);
      }
    });
  } else {
    const server = app.listen(Number(PORT), HOST, onReady('main')(HOST));
    server.on('error', (err: NodeJS.ErrnoException) => handleServerError(err, PORT, 'main'));
  }
}

main().catch((err) => {
  // A boot failure (e.g. a missing production ENCRYPTION_KEY) must exit
  // non-zero rather than leaving a half-initialized process that never starts
  // listening — that silent state is what surfaces in the client as
  // "Can't reach the server".
  console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
  process.exit(1);
});

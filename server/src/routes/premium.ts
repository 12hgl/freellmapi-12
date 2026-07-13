import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSetting, setSetting, getDb } from '../db/index.js';
import {
  catalogBaseUrl,
  getSyncState,
  syncCatalog,
} from '../services/catalog-sync.js';

export const premiumRouter = Router();

const SETTING_AUTO_SYNC = 'auto_sync_enabled';
const SETTING_AUTO_UPDATE = 'auto_update_enabled';

function statusPayload() {
  return {
    enabled: getSetting(SETTING_AUTO_SYNC) === 'true',
    autoUpdate: getSetting(SETTING_AUTO_UPDATE) !== 'false', // 默认开
    baseUrl: catalogBaseUrl(),
    catalog: getSyncState(),
  };
}

/** GET /api/premium */
premiumRouter.get('/', (_req: Request, res: Response) => {
  res.json(statusPayload());
});

/** POST /api/premium/toggle-sync { enabled } */
premiumRouter.post('/toggle-sync', async (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  setSetting(SETTING_AUTO_SYNC, String(enabled));
  if (enabled) {
    void syncCatalog(false);
  }
  res.json(statusPayload());
});

/** POST /api/premium/toggle-auto-update { autoUpdate } */
premiumRouter.post('/toggle-auto-update', async (req: Request, res: Response) => {
  const autoUpdate = req.body?.autoUpdate !== false;
  setSetting(SETTING_AUTO_UPDATE, String(autoUpdate));
  res.json(statusPayload());
});

/** POST /api/premium/sync */
premiumRouter.post('/sync', async (_req: Request, res: Response) => {
  const sync = await syncCatalog(false);
  res.json({ ...statusPayload(), sync });
});

/** POST /api/premium/set-custom-url { url, apiKey } */
premiumRouter.post('/set-custom-url', async (req: Request, res: Response) => {
  const { url, apiKey } = req.body ?? {};
  if (url) {
    setSetting('catalog_custom_base_url', String(url).trim());
  } else {
    setSetting('catalog_custom_base_url', '');
  }
  if (apiKey !== undefined) {
    setSetting('catalog_api_key', String(apiKey).trim());
  }
  res.json(statusPayload());
});

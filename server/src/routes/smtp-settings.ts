import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSetting, setSetting } from '../db/index.js';
import { isSmtpConfigured, getSmtpConfigFromDb, encryptSmtpPassword } from '../services/smtp.js';

export const smtpRouter = Router();

/** GET /api/smtp/config */
smtpRouter.get('/config', (_req: Request, res: Response) => {
  const dbConfig = getSmtpConfigFromDb();
  res.json({
    configured: isSmtpConfigured(),
    enabled: getSetting('smtp_enabled') !== '0',
    host: dbConfig.host || '',
    port: dbConfig.port || 587,
    user: dbConfig.user || '',
    // 不返回密码
    hasPass: !!dbConfig.pass,
    from: dbConfig.from || '',
  });
});

/** POST /api/smtp/config */
smtpRouter.post('/config', (req: Request, res: Response) => {
  const { host, port, user, pass, from, enabled } = req.body || {};

  if (host) setSetting('smtp_host', String(host).trim());
  if (port) setSetting('smtp_port', String(port));
  if (user) setSetting('smtp_user', String(user).trim());
  if (pass) setSetting('smtp_pass', encryptSmtpPassword(String(pass)));
  if (from !== undefined) setSetting('smtp_from', String(from).trim());
  if (enabled !== undefined) setSetting('smtp_enabled', enabled ? '1' : '0');

  res.json({ success: true, configured: isSmtpConfigured(), enabled: getSetting('smtp_enabled') !== '0' });
});

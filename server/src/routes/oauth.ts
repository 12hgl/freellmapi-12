/**
 * Microsoft OAuth 2.0 route for Outlook email authorization (consumer accounts).
 *
 * Uses Microsoft Device Code Flow to completely eliminate redirect_uri issues.
 *
 * Flow:
 *   GET  /api/oauth/microsoft/auth  → requests device_code from Microsoft
 *   POST /api/oauth/microsoft/poll  → polls for access_token
 *
 * The access_token is stored in settings (encrypted) and used by the SMTP
 * service for XOAUTH2 authentication with outlook.office365.com.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSetting, setSetting } from '../db/index.js';
import { encrypt } from '../lib/crypto.js';

export const oauthRouter = Router();

const MS_CLIENT_ID = '3dfac626-81f7-463e-8c32-e03dc0e1af95';
const MS_DEVICE_URL = 'https://login.live.com/oauth20_connect.srf';
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';

// Scopes for Microsoft consumer accounts (Live SDK + SMTP Send)
const MS_SCOPES = [
  'wl.offline_access',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

// ─── GET /api/oauth/microsoft/auth (Device Code Flow) ───────────────────
oauthRouter.get('/microsoft/auth', async (_req: Request, res: Response) => {
  try {
    const deviceRes = await fetch(MS_DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        scope: MS_SCOPES,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!deviceRes.ok) {
      const errText = await deviceRes.text();
      throw new Error(`Device code request failed: HTTP ${deviceRes.status} — ${errText}`);
    }

    const data = await deviceRes.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
      message?: string;
    };

    // Store device_code temporarily for polling (encrypted, short-lived)
    const { encrypted, iv, authTag } = encrypt(data.device_code);
    setSetting('oauth_device_code', `${encrypted}:${iv}:${authTag}`);
    setSetting('oauth_device_code_expiry', String(Date.now() + (data.expires_in || 900) * 1000));

    res.json({
      user_code: data.user_code,
      device_code: data.device_code,
      verification_uri: data.verification_uri || 'https://login.live.com/oauth20_connect.srf',
      interval: data.interval || 5,
      expires_in: data.expires_in || 900,
      message: data.message || '',
    });
  } catch (err: any) {
    console.error('[oauth] Device code request error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/oauth/microsoft/poll ─────────────────────────────────────
oauthRouter.post('/microsoft/poll', async (req: Request, res: Response) => {
  const { device_code } = req.body;

  if (!device_code || typeof device_code !== 'string') {
    res.status(400).json({ error: '缺少 device_code' });
    return;
  }

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    const body = await tokenRes.text();

    if (!tokenRes.ok) {
      if (body.includes('authorization_pending')) {
        res.json({ status: 'pending' });
        return;
      }
      if (body.includes('slow_down')) {
        res.json({ status: 'pending', slow_down: true });
        return;
      }
      if (body.includes('expired_token') || body.includes('authorization_declined')) {
        // Clean up stored device code
        setSetting('oauth_device_code', '');
        setSetting('oauth_device_code_expiry', '');
        res.json({ status: 'expired', error: body });
        return;
      }
      throw new Error(`Token request failed: HTTP ${tokenRes.status} — ${body}`);
    }

    const tokens = JSON.parse(body) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Store tokens encrypted
    const { encrypted: encAccess, iv: ivAccess, authTag: tagAccess } = encrypt(tokens.access_token);
    setSetting('oauth_outlook_access_token', `${encAccess}:${ivAccess}:${tagAccess}`);
    setSetting('oauth_outlook_token_expiry', String(Date.now() + (tokens.expires_in || 3600) * 1000));

    if (tokens.refresh_token) {
      const { encrypted: encRefresh, iv: ivRefresh, authTag: tagRefresh } = encrypt(tokens.refresh_token);
      setSetting('oauth_outlook_refresh_token', `${encRefresh}:${ivRefresh}:${tagRefresh}`);
    }

    // Configure SMTP settings for Outlook OAuth
    setSetting('smtp_host', 'smtp-mail.outlook.com');
    setSetting('smtp_port', '587');
    setSetting('smtp_oauth_provider', 'microsoft');

    // Clean up device code
    setSetting('oauth_device_code', '');
    setSetting('oauth_device_code_expiry', '');

    res.json({ status: 'completed' });
  } catch (err: any) {
    console.error('[oauth] Token poll error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/oauth/microsoft/status ────────────────────────────────────
oauthRouter.get('/microsoft/status', (_req: Request, res: Response) => {
  const accessToken = getSetting('oauth_outlook_access_token');
  const expiry = getSetting('oauth_outlook_token_expiry');
  const authorized = !!accessToken && (!expiry || Number(expiry) > Date.now());

  res.json({
    authorized,
    provider: 'microsoft',
    expiresAt: expiry ? Number(expiry) : null,
  });
});

// ─── POST /api/oauth/microsoft/revoke ───────────────────────────────────
oauthRouter.post('/microsoft/revoke', (_req: Request, res: Response) => {
  setSetting('oauth_outlook_access_token', '');
  setSetting('oauth_outlook_refresh_token', '');
  setSetting('oauth_outlook_token_expiry', '');
  setSetting('smtp_oauth_provider', '');
  // Don't clear SMTP host/port — user may switch to another provider
  res.json({ success: true });
});

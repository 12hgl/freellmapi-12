/**
 * Microsoft OAuth 2.0 route for Outlook email authorization.
 *
 * Flow:
 *   GET  /api/oauth/microsoft/auth     → returns { url } for Microsoft login
 *   GET  /api/oauth/microsoft/callback → exchanges code for access_token
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
const MS_REDIRECT_URI = 'http://localhost:3001/api/oauth/microsoft/callback';
const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// Scopes needed for sending email via Microsoft Graph / SMTP AUTH
const MS_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

// ─── GET /api/oauth/microsoft/auth ──────────────────────────────────────
oauthRouter.get('/microsoft/auth', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: MS_REDIRECT_URI,
    scope: MS_SCOPES,
    response_mode: 'query',
  });
  res.json({ url: `${MS_AUTH_URL}?${params.toString()}` });
});

// ─── GET /api/oauth/microsoft/callback ──────────────────────────────────
oauthRouter.get('/microsoft/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error) {
    res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>授权失败</h2>
        <p>${error_description || error}</p>
        <p>请关闭此窗口并重试。</p>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body></html>
    `);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>缺少授权码</h2>
        <p>未收到 Microsoft 返回的授权码，请重试。</p>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body></html>
    `);
    return;
  }

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        scope: MS_SCOPES,
        code,
        redirect_uri: MS_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token exchange failed: HTTP ${tokenRes.status} — ${errText}`);
    }

    const tokens = await tokenRes.json() as {
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

    // Also configure SMTP settings for Outlook OAuth
    setSetting('smtp_host', 'smtp-mail.outlook.com');
    setSetting('smtp_port', '587');
    setSetting('smtp_oauth_provider', 'microsoft');

    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2 style="color:#16a34a">授权成功！</h2>
        <p>Outlook 邮箱已成功授权，此窗口即将关闭。</p>
        <script>setTimeout(()=>window.close(),2000)</script>
      </body></html>
    `);
  } catch (err: any) {
    console.error('[oauth] Microsoft token exchange error:', err.message);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>授权失败</h2>
        <p>${err.message}</p>
        <p>请关闭此窗口并重试。</p>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body></html>
    `);
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

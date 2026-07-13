import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, getSetting, setSetting } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { applyProxyUrl, applyProxyEnabled, applyProxyBypass, isProxyActive, getProxyUrl, isProxyEnabled, getProxyBypassPlatforms } from '../lib/proxy.js';
import { getSavedFusionConfig, setSavedFusionConfig, savedFusionConfigSchema, getFusionMaxK } from '../services/fusion.js';
import { isUnifyEnabled, setUnifyEnabled, getUnifyOverrides, setUnifyOverrides, unifyOverridesSchema } from '../services/model-groups.js';
import { getClaudeModelMap, setClaudeModelMap } from '../services/anthropic-map.js';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIpLimitConfig, setIpLimitConfig } from '../services/ip-rate-limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const settingsRouter = Router();

// Get the model-unification setting: the global toggle (default ON) plus any
// merge/split overrides. Governs the dashboard grouping, /v1/models grouping,
// and cross-provider pin failover.
settingsRouter.get('/unify', (_req: Request, res: Response) => {
  res.json({ enabled: isUnifyEnabled(), overrides: getUnifyOverrides() });
});

const unifyPutSchema = z.object({
  enabled: z.boolean().optional(),
  overrides: unifyOverridesSchema.optional(),
});

// Update the unify toggle and/or overrides. Partial: send just `enabled` to
// flip the switch, or `overrides` to adjust grouping, or both.
settingsRouter.put('/unify', (req: Request, res: Response) => {
  const parsed = unifyPutSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ');
    res.status(400).json({ error: { message: `Invalid unify settings: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  if (parsed.data.enabled !== undefined) setUnifyEnabled(parsed.data.enabled);
  if (parsed.data.overrides) setUnifyOverrides(parsed.data.overrides);
  res.json({ enabled: isUnifyEnabled(), overrides: getUnifyOverrides() });
});

// Get the saved fusion default config (panel mode, models, judge, k, strategy).
settingsRouter.get('/fusion', (_req: Request, res: Response) => {
  res.json({ config: getSavedFusionConfig(), maxK: getFusionMaxK() });
});

// Save the fusion default config. A request's inline `fusion` field still
// overrides this per call (see services/fusion.ts resolveEffectiveConfig).
settingsRouter.put('/fusion', (req: Request, res: Response) => {
  const parsed = savedFusionConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.errors.map(e => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ');
    res.status(400).json({ error: { message: `Invalid fusion config: ${detail}`, type: 'invalid_request_error' } });
    return;
  }
  const saved = setSavedFusionConfig(parsed.data);
  res.json({ config: saved, maxK: getFusionMaxK() });
});

// Get the Claude Code model map (opus/sonnet/haiku/default → 'auto' | model_id).
// Drives how the Anthropic /v1/messages route resolves Claude Code's built-in
// model names against the free pool.
settingsRouter.get('/anthropic-map', (_req: Request, res: Response) => {
  res.json({ map: getClaudeModelMap() });
});

// Update the Claude Code model map. Partial: send just the families you want to
// change; each value is 'auto' or a catalog model_id.
settingsRouter.put('/anthropic-map', (req: Request, res: Response) => {
  try {
    res.json({ map: setClaudeModelMap(req.body) });
  } catch (err: any) {
    const detail = err?.errors
      ? err.errors.map((e: any) => (e.path?.length ? `${e.path.join('.')}: ${e.message}` : e.message)).slice(0, 5).join(', ')
      : (err?.message ?? 'invalid');
    res.status(400).json({ error: { message: `Invalid anthropic model map: ${detail}`, type: 'invalid_request_error' } });
  }
});

// Get the unified API key (first enabled key for backward compat)
settingsRouter.get('/api-key', (_req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT key_value, encrypted_key, iv, auth_tag FROM unified_api_keys WHERE enabled = 1 LIMIT 1'
  ).get() as { key_value: string | null; encrypted_key: string | null; iv: string | null; auth_tag: string | null } | undefined;

  let apiKey = '';
  if (row) {
    if (row.encrypted_key && row.iv && row.auth_tag) {
      try {
        apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      } catch {
        apiKey = row.key_value ?? '';
      }
    } else {
      apiKey = row.key_value ?? '';
    }
  }
  res.json({ apiKey });
});

// Regenerate the unified API key (create new, returns it)
settingsRouter.post('/api-key/regenerate', (_req: Request, res: Response) => {
  const db = getDb();
  const keyValue = 'freellmapi-' + crypto.randomBytes(24).toString('hex');
  const { encrypted: encKey, iv, authTag } = encrypt(keyValue);
  db.prepare(
    'INSERT INTO unified_api_keys (key_value, encrypted_key, iv, auth_tag, name) VALUES (?, ?, ?, ?, ?)'
  ).run(keyValue, encKey, iv, authTag, '');
  res.json({ apiKey: keyValue });
});

// Get the proxy settings
settingsRouter.get('/proxy', (_req: Request, res: Response) => {
  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});

// Set the proxy settings. Accepts partial updates: proxyUrl, enabled, bypassPlatforms.
settingsRouter.put('/proxy', (req: Request, res: Response) => {
  const { proxyUrl, enabled, bypassPlatforms } = req.body as {
    proxyUrl?: string;
    enabled?: boolean;
    bypassPlatforms?: string[];
  };

  // --- proxyUrl ---
  if (typeof proxyUrl === 'string') {
    const trimmed = proxyUrl.trim();
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(u.protocol)) {
          res.status(400).json({
            error: { message: 'Proxy URL must use http, https, socks5, or socks4 scheme', type: 'invalid_request_error' },
          });
          return;
        }
      } catch {
        res.status(400).json({
          error: { message: 'Invalid proxy URL — must be a valid URL like socks5://host:port', type: 'invalid_request_error' },
        });
        return;
      }
      setSetting('proxy_url', trimmed);
    } else {
      setSetting('proxy_url', '');
    }
    applyProxyUrl(trimmed);
  }

  // --- enabled ---
  if (typeof enabled === 'boolean') {
    setSetting('proxy_enabled', enabled ? '1' : '0');
    applyProxyEnabled(enabled);
  }

  // --- bypassPlatforms ---
  if (Array.isArray(bypassPlatforms)) {
    const csv = bypassPlatforms.map(s => s.trim()).filter(Boolean).join(',');
    setSetting('proxy_bypass', csv);
    applyProxyBypass(csv);
  }

  res.json({
    proxyUrl: getProxyUrl(),
    enabled: isProxyEnabled(),
    bypassPlatforms: getProxyBypassPlatforms(),
    active: isProxyActive(),
  });
});

// ─── Admin port separation toggle ────────────────────────────────────────
settingsRouter.get('/admin-port-separation', (_req: Request, res: Response) => {
  res.json({ enabled: getSetting('admin_port_separation') === '1' });
});

settingsRouter.post('/admin-port-separation', (req: Request, res: Response) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  setSetting('admin_port_separation', enabled ? '1' : '0');
  res.json({ enabled, restartRequired: true });
});

// ─── Auto-check source API keys toggle ─────────────────────────────────
settingsRouter.get('/api-key-check', (_req: Request, res: Response) => {
  res.json({ enabled: getSetting('auto_key_check') === '1' });
});

settingsRouter.post('/api-key-check', (req: Request, res: Response) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  setSetting('auto_key_check', enabled ? '1' : '0');
  res.json({ enabled });
});

// ─── IP Login Rate Limiter ──────────────────────────────────────────────
settingsRouter.get('/ip-limit', (_req: Request, res: Response) => {
  res.json(getIpLimitConfig());
});

settingsRouter.put('/ip-limit', (req: Request, res: Response) => {
  const { enabled, threshold, duration } = (req.body || {}) as {
    enabled?: boolean;
    threshold?: number;
    duration?: number;
  };
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 1)) {
    res.status(400).json({ error: 'threshold must be a positive number' });
    return;
  }
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 1)) {
    res.status(400).json({ error: 'duration must be a positive number (seconds)' });
    return;
  }
  setIpLimitConfig(enabled ?? true, threshold ?? 5, duration ?? 180);
  res.json(getIpLimitConfig());
});

// ─── SMTP Log Toggle ────────────────────────────────────────────────────
settingsRouter.get('/smtp-log', (_req: Request, res: Response) => {
  res.json({
    enabled: getSetting('smtp_log_enabled') !== '0',
    showCode: getSetting('smtp_log_show_code') === '1',
  });
});

settingsRouter.put('/smtp-log', (req: Request, res: Response) => {
  const { enabled, showCode } = (req.body || {}) as {
    enabled?: boolean;
    showCode?: boolean;
  };
  if (typeof enabled === 'boolean') setSetting('smtp_log_enabled', enabled ? '1' : '0');
  if (typeof showCode === 'boolean') setSetting('smtp_log_show_code', showCode ? '1' : '0');
  res.json({
    enabled: getSetting('smtp_log_enabled') !== '0',
    showCode: getSetting('smtp_log_show_code') === '1',
  });
});

// ─── Latest Version ──────────────────────────────────────────────────
// Fetches LATEST.json from GitHub repo, falls back to local copy.
// Returns version + changelog + hasUpdate flag for the frontend.
const GITHUB_LATEST_URL = 'https://raw.githubusercontent.com/12hgl/freellmapi-12/main/LATEST.json';
const CURRENT_VERSION = '1.17';

settingsRouter.get('/latest-version', async (_req: Request, res: Response) => {
  const fallback = (version: string, changelog: string) => {
    res.json({
      version,
      changelog,
      hasUpdate: version !== CURRENT_VERSION,
    });
  };

  try {
    const response = await fetch(GITHUB_LATEST_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { version?: string; changelog?: string };
    fallback(data.version || CURRENT_VERSION, data.changelog || '');
  } catch {
    // Network error: fall back to local LATEST.json
    try {
      const latestPath = path.resolve(__dirname, '../../LATEST.json');
      if (fs.existsSync(latestPath)) {
        const raw = fs.readFileSync(latestPath, 'utf-8');
        const data = JSON.parse(raw);
        fallback(data.version || CURRENT_VERSION, data.changelog || '');
      } else {
        fallback(CURRENT_VERSION, '');
      }
    } catch {
      fallback(CURRENT_VERSION, '');
    }
  }
});

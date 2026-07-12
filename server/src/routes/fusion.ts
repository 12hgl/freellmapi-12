/**
 * Fusion API Key management — CRUD for composite API keys that route
 * requests across multiple providers with per-key rate limits.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { encrypt, decrypt } from '../lib/crypto.js';

export const fusionRouter = Router();

// All fusion endpoints require dashboard auth
fusionRouter.use(requireAuth);

// ── Types ──────────────────────────────────────────────────────────────────

interface FusionKeyRow {
  id: number;
  key_value: string | null;
  encrypted_key: string | null;
  iv: string | null;
  auth_tag: string | null;
  name: string;
  provider_ids: string;
  model_ids: string;
  rate_limit_rpm: number;
  enabled: number;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
}

function resolveKey(row: FusionKeyRow): string {
  if (row.encrypted_key && row.iv && row.auth_tag) {
    try {
      return decrypt(row.encrypted_key, row.iv, row.auth_tag);
    } catch {
      // Fall through to plaintext
    }
  }
  return row.key_value ?? '';
}

function rowToPublic(row: FusionKeyRow) {
  return {
    id: row.id,
    keyValue: resolveKey(row),
    name: row.name,
    providerIds: JSON.parse(row.provider_ids) as string[],
    modelIds: JSON.parse(row.model_ids) as string[],
    rateLimitRpm: row.rate_limit_rpm,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    requestCount: row.request_count,
  };
}

// ── List all fusion keys ───────────────────────────────────────────────────

fusionRouter.get('/list', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM fusion_api_keys ORDER BY created_at DESC'
  ).all() as FusionKeyRow[];

  res.json({ keys: rows.map(rowToPublic) });
});

// ── Create a new fusion key ────────────────────────────────────────────────

fusionRouter.post('/create', (req: Request, res: Response) => {
  const db = getDb();
  const { name, providerIds, modelIds, rateLimitRpm } = (req.body ?? {}) as {
    name?: string;
    providerIds?: string[];
    modelIds?: string[];
    rateLimitRpm?: number;
  };

  const keyName = (name ?? '').trim() || '未命名密钥';
  const providers = Array.isArray(providerIds) && providerIds.length > 0
    ? providerIds
    : ['freeqwq'];
  const models = Array.isArray(modelIds) && modelIds.length > 0
    ? modelIds
    : ['*'];
  const rpm = typeof rateLimitRpm === 'number' && rateLimitRpm > 0
    ? rateLimitRpm
    : 60;

  // Generate a random fusion key: fap- + 48 hex chars
  const keyValue = 'fap-' + crypto.randomBytes(24).toString('hex');
  const { encrypted: encKey, iv, authTag } = encrypt(keyValue);

  db.prepare(`
    INSERT INTO fusion_api_keys (key_value, encrypted_key, iv, auth_tag, name, provider_ids, model_ids, rate_limit_rpm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(keyValue, encKey, iv, authTag, keyName, JSON.stringify(providers), JSON.stringify(models), rpm);

  const row = db.prepare('SELECT * FROM fusion_api_keys WHERE encrypted_key = ?').get(encKey) as FusionKeyRow;
  res.status(201).json({ key: rowToPublic(row) });
});

// ── Delete a fusion key ────────────────────────────────────────────────────

fusionRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: '无效的密钥ID' } });
    return;
  }

  const result = db.prepare('DELETE FROM fusion_api_keys WHERE id = ?').run(id as any);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: '密钥不存在' } });
    return;
  }

  res.json({ success: true, message: '密钥已删除' });
});

// ── Toggle enable/disable a fusion key ─────────────────────────────────────

fusionRouter.post('/:id/toggle', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: '无效的密钥ID' } });
    return;
  }

  const row = db.prepare('SELECT enabled FROM fusion_api_keys WHERE id = ?').get(id as any) as { enabled: number } | undefined;
  if (!row) {
    res.status(404).json({ error: { message: '密钥不存在' } });
    return;
  }

  const newState = row.enabled === 1 ? 0 : 1;
  db.prepare('UPDATE fusion_api_keys SET enabled = ? WHERE id = ?').run(newState as any, id as any);

  res.json({ id, enabled: newState === 1, message: newState === 1 ? '密钥已启用' : '密钥已禁用' });
});

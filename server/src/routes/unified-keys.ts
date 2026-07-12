import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';

export const unifiedKeysRouter = Router();

function generateKey(): string {
  return `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
}

function resolveKey(row: { key_value: string | null; encrypted_key: string | null; iv: string | null; auth_tag: string | null }): string {
  if (row.encrypted_key && row.iv && row.auth_tag) {
    try {
      return decrypt(row.encrypted_key, row.iv, row.auth_tag);
    } catch {
      // Fall through
    }
  }
  return row.key_value ?? '';
}

function listKeys() {
  const db = getDb();
  return db.prepare(
    'SELECT id, key_value, encrypted_key, iv, auth_tag, name, enabled, created_at, last_used_at, request_count FROM unified_api_keys ORDER BY id ASC'
  ).all() as any[];
}

/** GET /api/unified-keys */
unifiedKeysRouter.get('/', (_req: Request, res: Response) => {
  res.json(listKeys());
});

/** POST /api/unified-keys */
unifiedKeysRouter.post('/', (req: Request, res: Response) => {
  const { name } = req.body ?? {};
  const keyValue = generateKey();
  const { encrypted: encKey, iv, authTag } = encrypt(keyValue);
  const db = getDb();
  db.prepare(
    'INSERT INTO unified_api_keys (key_value, encrypted_key, iv, auth_tag, name) VALUES (?, ?, ?, ?, ?)'
  ).run(keyValue, encKey, iv, authTag, (name ?? '新密钥').trim() || '新密钥');
  res.status(201).json(listKeys());
});

/** DELETE /api/unified-keys/:id */
unifiedKeysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: '无效的密钥 ID' } });
    return;
  }
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM unified_api_keys').get() as { c: number }).c;
  if (count <= 1) {
    res.status(400).json({ error: { message: '至少保留一个统一 API 密钥' } });
    return;
  }
  db.prepare('DELETE FROM unified_api_keys WHERE id = ?').run(id);
  res.json(listKeys());
});

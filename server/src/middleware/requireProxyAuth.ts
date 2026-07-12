/**
 * /v1 代理认证中间件：同时支持统一 API Key 和融合 API Key。
 *
 * 认证优先级：
 *   1. 统一 API Key（sk- 前缀）— 完全权限，访问所有模型
 *   2. 融合 API Key（fap- 前缀）— 绑定提供商/模型/速率限制
 *   3. 其余 → 401
 *
 * 认证成功后在 req 上挂载 proxyAuth 对象。
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';

export interface ProxyAuthInfo {
  type: 'unified' | 'fusion';
  // fusion key 专属字段
  fusionKeyId?: number;
  fusionProviderIds?: string[];
  fusionModelIds?: string[];
  fusionRateLimitRpm?: number;
}

// 常量时间字符串比较，防止时序攻击
function timingSafeStringEqual(provided: string, expected: string): boolean {
  const key = Buffer.alloc(32);
  const a = crypto.createHmac('sha256', key).update(provided).digest();
  const b = crypto.createHmac('sha256', key).update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function extractApiToken(req: Request): string | undefined {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const apiKeyHeader = req.headers['x-api-key'];
  const xApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  return xApiKey?.trim() || undefined;
}

/**
 * Resolve the real key value from either encrypted or plaintext columns.
 * Prefers encrypted columns; falls back to plaintext key_value for rows
 * that have not yet been migrated.
 */
function resolveKey(
  keyValue: string | null,
  encryptedKey: string | null,
  iv: string | null,
  authTag: string | null,
): string | null {
  if (encryptedKey && iv && authTag) {
    try {
      return decrypt(encryptedKey, iv, authTag);
    } catch {
      // Decryption failed — fall through to plaintext fallback.
    }
  }
  return keyValue || null;
}

export function requireProxyAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractApiToken(req);
  if (!token) {
    res.status(401).json({
      error: { message: '缺少 API Key，请在 Authorization 头中提供 Bearer Token 或使用 x-api-key 头', type: 'authentication_error' },
    });
    return;
  }

  // 1. 检查统一 API Key（多密钥支持）
  // 遍历所有 key 后才统一返回，防止逐 key 时序侧信道泄露有效 key。
  const db = getDb();
  const unifiedRow = db.prepare(
    'SELECT id, key_value, encrypted_key, iv, auth_tag FROM unified_api_keys WHERE enabled = 1'
  ).all() as { id: number; key_value: string | null; encrypted_key: string | null; iv: string | null; auth_tag: string | null }[];

  let matchedUnifiedId: number | null = null;
  for (const row of unifiedRow) {
    const realKey = resolveKey(row.key_value, row.encrypted_key, row.iv, row.auth_tag);
    if (realKey && timingSafeStringEqual(token, realKey)) {
      matchedUnifiedId = row.id;
    }
  }

  if (matchedUnifiedId !== null) {
    db.prepare(
      'UPDATE unified_api_keys SET last_used_at = datetime(\'now\'), request_count = request_count + 1 WHERE id = ?'
    ).run(matchedUnifiedId);
    (req as any).proxyAuth = { type: 'unified' } as ProxyAuthInfo;
    next();
    return;
  }

  // 2. 检查融合 API Key（fap- 前缀）
  if (token.startsWith('fap-')) {
    const fusionRows = db.prepare(
      'SELECT id, provider_ids, model_ids, rate_limit_rpm, enabled, key_value, encrypted_key, iv, auth_tag FROM fusion_api_keys WHERE enabled = 1'
    ).all() as { id: number; provider_ids: string; model_ids: string; rate_limit_rpm: number; enabled: number; key_value: string | null; encrypted_key: string | null; iv: string | null; auth_tag: string | null }[];

    let matchedFusion: { id: number; provider_ids: string; model_ids: string; rate_limit_rpm: number } | null = null;
    for (const row of fusionRows) {
      const realKey = resolveKey(row.key_value, row.encrypted_key, row.iv, row.auth_tag);
      if (realKey && timingSafeStringEqual(token, realKey)) {
        matchedFusion = row;
        break;
      }
    }

    if (!matchedFusion) {
      res.status(401).json({
        error: { message: '无效的 API Key 或密钥已禁用', type: 'authentication_error' },
      });
      return;
    }

    // 更新最后使用时间
    db.prepare(
      'UPDATE fusion_api_keys SET last_used_at = datetime(\'now\'), request_count = request_count + 1 WHERE id = ?'
    ).run(matchedFusion.id);

    (req as any).proxyAuth = {
      type: 'fusion',
      fusionKeyId: matchedFusion.id,
      fusionProviderIds: JSON.parse(matchedFusion.provider_ids) as string[],
      fusionModelIds: JSON.parse(matchedFusion.model_ids) as string[],
      fusionRateLimitRpm: matchedFusion.rate_limit_rpm,
    } as ProxyAuthInfo;
    next();
    return;
  }

  // 3. 无效密钥
  res.status(401).json({
    error: { message: '无效的 API Key', type: 'authentication_error' },
  });
}

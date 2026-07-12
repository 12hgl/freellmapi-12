import type { Db } from '../types.js';

export function up(db: Db): void {
  // ── SMTP 2FA verification codes ────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vc_email_expiry ON verification_codes(email, expires_at_ms);
  `);

  // ── Fusion API Keys management ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS fusion_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      provider_ids TEXT NOT NULL DEFAULT '[]',
      model_ids TEXT NOT NULL DEFAULT '["*"]',
      rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      request_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_fak_key_value ON fusion_api_keys(key_value);
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS verification_codes');
  db.exec('DROP TABLE IF EXISTS fusion_api_keys');
}

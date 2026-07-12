import type { Db } from '../types.js';

export function up(db: Db): void {
  // ── Multi Unified API Keys table ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS unified_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      request_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_uak_key_value ON unified_api_keys(key_value);
  `);

  // Migrate existing single unified key from settings table
  const row = db.prepare(
    "SELECT value FROM settings WHERE key = 'unified_api_key'"
  ).get() as { value: string } | undefined;

  if (row && row.value) {
    db.prepare(
      "INSERT OR IGNORE INTO unified_api_keys (key_value, name) VALUES (?, '默认密钥')"
    ).run(row.value);
  }
}

export function down(db: Db): void {
  // Restore first key back to settings before dropping
  const first = db.prepare(
    'SELECT key_value FROM unified_api_keys ORDER BY id ASC LIMIT 1'
  ).get() as { key_value: string } | undefined;

  if (first) {
    db.prepare(
      "UPDATE settings SET value = ? WHERE key = 'unified_api_key'"
    ).run(first.key_value);
  }

  db.exec('DROP TABLE IF EXISTS unified_api_keys');
}

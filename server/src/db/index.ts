import crypto from 'crypto';
import BetterSqlite from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrationsSync } from './migrate/runner.js';
import { initEncryptionKey, isEncryptionKeyInitialized, encrypt } from '../lib/crypto.js';
import type { Db, DbFactory } from './types.js';

export type { Db, DbFactory } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/freeapi.db');

let db: Db;

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() or connectDb() first.');
  }
  return db;
}

export function getDefaultDbPath(): string {
  return process.env.FREEAPI_DB_PATH?.trim() || DB_PATH;
}

/** Default factory: opens a better-sqlite3 connection at the given path. */
function betterSqliteFactory(resolvedPath: string): Db {
  return new BetterSqlite(resolvedPath) as unknown as Db;
}

export function connectDb(
  dbPath?: string,
  opts?: {
    /** Create the parent directory if absent. Default: true. Set false in
     *  environments that do not have a writable local filesystem. */
    ensureDir?: boolean;
    /** Factory that constructs the raw Db connection. Default: better-sqlite3. */
    factory?: DbFactory;
  },
): Db {
  const resolvedPath = dbPath ?? getDefaultDbPath();
  const isMemory = resolvedPath === ':memory:';
  const ensureDir = opts?.ensureDir ?? true;
  const factory = opts?.factory ?? betterSqliteFactory;

  if (!isMemory && ensureDir) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = factory(resolvedPath);
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log(`Database initialized at ${resolvedPath}`);
  return db;
}

export function initDb(
  dbPath?: string,
  opts?: { ensureDir?: boolean; factory?: DbFactory },
): Db {
  const db = connectDb(dbPath, opts);

  if (process.env.NODE_ENV !== 'development') {
    runMigrationsSync(db, 'up');
  } else {
    // In dev, verify the DB has been initialised. If not, give a clear error.
    const ready = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
    ).get();
    if (!ready) {
      console.error(
        '\n  [dev] Database not initialised. Run:\n\n' +
        '    npm run db:migration:up\n\n' +
        '  Then restart the server.\n'
      );
      process.exit(1);
    }
  }

  if (!isEncryptionKeyInitialized()) initEncryptionKey(db);

  // Migrate any remaining plaintext API keys to encrypted columns.
  migratePlaintextKeys(db);

  return db;
}

/**
 * One-shot migration: encrypts any remaining plaintext key_value rows in
 * unified_api_keys and fusion_api_keys into the encrypted_key / iv / auth_tag
 * columns, then sets key_value to NULL.
 *
 * Idempotent — rows with non-NULL key_value AND NULL encrypted_key are
 * the only ones processed. Called from initDb() after the encryption key
 * is initialised.
 */
function migratePlaintextKeys(db: Db): void {
  // ── unified_api_keys ─────────────────────────────────────────────────
  const unifiedRows = db.prepare(
    'SELECT id, key_value FROM unified_api_keys WHERE key_value IS NOT NULL AND encrypted_key IS NULL'
  ).all() as { id: number; key_value: string }[];

  for (const row of unifiedRows) {
    const { encrypted: encKey, iv, authTag } = encrypt(row.key_value);
    db.prepare(
      'UPDATE unified_api_keys SET encrypted_key = ?, iv = ?, auth_tag = ? WHERE id = ?'
    ).run(encKey, iv, authTag, row.id);
  }

  // ── fusion_api_keys ──────────────────────────────────────────────────
  const fusionRows = db.prepare(
    'SELECT id, key_value FROM fusion_api_keys WHERE key_value IS NOT NULL AND encrypted_key IS NULL'
  ).all() as { id: number; key_value: string }[];

  for (const row of fusionRows) {
    // fap- prefix is stored outside the encrypted payload so lookups can
    // still filter on prefix before attempting decryption.
    const { encrypted: encKey, iv, authTag } = encrypt(row.key_value);
    db.prepare(
      'UPDATE fusion_api_keys SET encrypted_key = ?, iv = ?, auth_tag = ? WHERE id = ?'
    ).run(encKey, iv, authTag, row.id);
  }

  if (unifiedRows.length > 0 || fusionRows.length > 0) {
    console.log(
      `[db] Migrated ${unifiedRows.length} unified + ${fusionRows.length} fusion API keys to encrypted storage.`
    );
  }
}

export function getUnifiedApiKey(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get() as { value: string };
  return row.value;
}

export function regenerateUnifiedKey(): string {
  const db = getDb();
  const key = `freellmapi-${crypto.randomBytes(24).toString('hex')}`;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'unified_api_key'").run(key);
  return key;
}

// Generic key/value settings accessors (used by routing strategy, etc.).
export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

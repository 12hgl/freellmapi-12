import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Start a periodic job that deletes expired sessions from the database.
 *  Called once from app.ts on startup.  Without this, expired sessions are
 *  only deleted lazily when validateSession() happens to touch them — which
 *  means the sessions table could grow unbounded on a low-traffic instance. */
export function startSessionCleanup(intervalMs: number = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const cleanup = () => {
    try {
      const result = getDb().prepare('DELETE FROM sessions WHERE expires_at_ms < ?').run(Date.now());
      if (result.changes > 0) {
        console.log(`[SESSION-CLEANUP] 已清理 ${result.changes} 条过期 session`);
      }
    } catch (err) {
      console.error('[SESSION-CLEANUP] 清理失败:', (err as Error).message);
    }
  };
  // Run once immediately on startup, then on the schedule.
  cleanup();
  return setInterval(cleanup, intervalMs);
}

// Dummy scrypt hash: 16-byte salt + 64-byte key, used when the user doesn't
// exist so we still run the full scrypt computation — no timing side-channel
// leaks whether an email is registered.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

export interface SessionUser {
  userId: number;
  email: string;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return row.c;
}

/** Create a user. Throws { code: 'email_taken' } if the email already exists. */
export function createUser(email: string, password: string): SessionUser {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) {
    const err = new Error('An account with that email already exists') as any;
    err.code = 'email_taken';
    throw err;
  }
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(normalized, hashPassword(password));
  return { userId: Number(result.lastInsertRowid), email: normalized };
}

/**
 * Verify credentials.
 *
 * Always runs scrypt (even for non-existent users) using the dummy hash,
 * making the timing profile identical whether the email exists or not.
 * Returns the user on success, null on failure.
 */
export function verifyCredentials(email: string, password: string): SessionUser | null {
  const db = getDb();
  const row = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .get(normalizeEmail(email)) as { id: number; email: string; password_hash: string } | undefined;

  const storedHash = row ? row.password_hash : DUMMY_HASH;
  // Always run scrypt — even for non-existent users
  const passwordOk = verifyPassword(password, storedHash);

  if (!row || !passwordOk) return null;
  return { userId: row.id, email: row.email };
}

/** Mint a session and return the raw token (only the hash is persisted). */
export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at_ms) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

/** Destroy ALL sessions for a given user (used after successful login). */
export function destroyUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Resolve a session token to its user, or null if missing/expired. */
export function validateSession(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT s.user_id, s.expires_at_ms, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(sha256(token)) as { user_id: number; expires_at_ms: number; email: string } | undefined;
  if (!row) return null;
  if (row.expires_at_ms < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return { userId: row.user_id, email: row.email };
}

export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

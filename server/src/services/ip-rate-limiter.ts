/**
 * Login rate limiter with file persistence — IP + account dual-layer.
 *
 * IP layer:   Tracks failed login attempts per IP address.
 *             Configurable threshold & ban duration via settings.
 *
 * Email layer: Tracks failed login attempts per email (account).
 *             Uses the same threshold/duration as IP layer.
 *
 * Send-code:  Rate limits verification code sending per-IP and per-email.
 *
 * Data stored in: server/data/rate_limits.json
 *
 * Configurable via settings:
 *   ip_limit_enabled   — master toggle (default: '1')
 *   ip_limit_threshold — failed attempts before ban (default: 5)
 *   ip_limit_duration  — ban duration in seconds (default: 180 = 3 min)
 */

import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from '../db/index.js';

interface RateEntry {
  failures: number;
  bannedUntil: number; // timestamp ms
}

interface StoreData {
  ip: Record<string, RateEntry>;
  email: Record<string, RateEntry>;
  sendCode: Record<string, { lastSentMs: number }>;
}

const DATA_FILE = path.resolve('server/data/rate_limits.json');

let store: StoreData = { ip: {}, email: {}, sendCode: {} };

function loadStore(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      store.ip = raw.ip || {};
      store.email = raw.email || {};
      store.sendCode = raw.sendCode || {};
      cleanExpiredAll();
    }
  } catch (err) {
    console.error('[RATE-LIMIT] 加载限流数据失败，使用空存储:', (err as Error).message);
    store = { ip: {}, email: {}, sendCode: {} };
  }
}

function saveStore(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to a temporary file first, then rename to the
    // target path.  This prevents a concurrent reader from seeing a
    // partially-written file and avoids write-corruption races when
    // multiple requests call saveStore() at the same time.
    const tmpFile = DATA_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error('[RATE-LIMIT] 保存限流数据失败:', (err as Error).message);
  }
}

function cleanExpired(map: Record<string, RateEntry>): boolean {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(map)) {
    const entry = map[key];
    if (entry.bannedUntil > 0 && entry.bannedUntil < now) {
      delete map[key];
      changed = true;
    }
  }
  return changed;
}

function cleanExpiredAll(): void {
  const c1 = cleanExpired(store.ip);
  const c2 = cleanExpired(store.email);
  if (c1 || c2) saveStore();
}

// Initialize on import
loadStore();

// ═══════════════════════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_THRESHOLD = 5;
const DEFAULT_DURATION_SECONDS = 180;

function getThreshold(): number {
  const val = getSetting('ip_limit_threshold');
  const n = Number(val);
  return (n > 0 && Number.isFinite(n)) ? n : DEFAULT_THRESHOLD;
}

function getDurationMs(): number {
  const val = getSetting('ip_limit_duration');
  const n = Number(val);
  return ((n > 0 && Number.isFinite(n)) ? n : DEFAULT_DURATION_SECONDS) * 1000;
}

function isEnabled(): boolean {
  return getSetting('ip_limit_enabled') !== '0';
}

function normalize(key: string): string {
  return key.trim().toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Client IP (FIXED: no longer trusts X-Forwarded-For)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get effective client IP.
 *
 * Primary source is socket.remoteAddress — the physical peer address, which
 * cannot be spoofed via headers.  Falls back to req.ip (Express's opinionated
 * IP getter) only when remoteAddress is undefined (e.g. destroyed socket).
 *
 * WARNING:  req.ip is derived from X-Forwarded-For when `trust proxy` is
 * enabled in Express.  If trust proxy is ever turned on in the future,
 * this fallback path will re-introduce IP spoofing.  The caller should
 * verify that trust proxy is NOT enabled before relying on this value.
 */
export function getClientIp(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  ips?: string[];
}): string {
  let addr = req.socket?.remoteAddress;
  if (!addr) {
    // Fallback: req.ip only.  Express derives this from X-Forwarded-For
    // when `trust proxy` is enabled, which would allow IP spoofing.
    // Guard: if req.ips has more than 0 entries, trust proxy is active.
    if (req.ips && req.ips.length > 0) {
      console.warn('[RATE-LIMIT] trust proxy appears enabled — req.ip may be spoofed via X-Forwarded-For');
    }
    addr = req.ip;
  }
  if (!addr) addr = '127.0.0.1';
  // Normalize IPv4-mapped IPv6
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return addr;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Generic ban check / record / clear
// ═══════════════════════════════════════════════════════════════════════════

function isBanned(map: Record<string, RateEntry>, key: string): boolean {
  const entry = map[normalize(key)];
  if (!entry) return false;
  if (entry.bannedUntil > Date.now()) return true;
  if (entry.bannedUntil > 0) {
    delete map[normalize(key)];
    saveStore();
  }
  return false;
}

function recordFailure(map: Record<string, RateEntry>, key: string, label: string): void {
  const nk = normalize(key);
  let entry = map[nk];
  if (!entry) {
    entry = { failures: 0, bannedUntil: 0 };
  }

  if (entry.bannedUntil > Date.now()) return; // already banned

  if (entry.bannedUntil > 0 && entry.bannedUntil < Date.now()) {
    entry = { failures: 0, bannedUntil: 0 };
  }

  entry.failures++;
  if (entry.failures >= getThreshold()) {
    const durSec = Math.round(getDurationMs() / 1000);
    entry.bannedUntil = Date.now() + getDurationMs();
    console.log(`[RATE-LIMIT] ${label} ${nk} 已被封禁 ${durSec} 秒（${entry.failures} 次失败）`);
  }

  map[nk] = entry;
  saveStore();
}

function clearFailures(map: Record<string, RateEntry>, key: string): void {
  const nk = normalize(key);
  if (map[nk]) {
    delete map[nk];
    saveStore();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  IP layer — public API
// ═══════════════════════════════════════════════════════════════════════════

export function isIpBanned(ip: string): boolean {
  if (!isEnabled()) return false;
  return isBanned(store.ip, ip);
}

export function recordIpFailure(ip: string): void {
  if (!isEnabled()) return;
  recordFailure(store.ip, ip, 'IP');
}

export function clearIpFailures(ip: string): void {
  clearFailures(store.ip, ip);
}

export function getIpBanRemainingSeconds(ip: string): number {
  const entry = store.ip[normalize(ip)];
  if (!entry || entry.bannedUntil <= Date.now()) return 0;
  return Math.ceil((entry.bannedUntil - Date.now()) / 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Email (account) layer — public API
// ═══════════════════════════════════════════════════════════════════════════

export function isEmailBanned(email: string): boolean {
  if (!isEnabled()) return false;
  return isBanned(store.email, email);
}

export function recordEmailFailure(email: string): void {
  if (!isEnabled()) return;
  recordFailure(store.email, email, 'Email');
}

export function clearEmailFailures(email: string): void {
  clearFailures(store.email, email);
}

export function getEmailBanRemainingSeconds(email: string): number {
  const entry = store.email[normalize(email)];
  if (!entry || entry.bannedUntil <= Date.now()) return 0;
  return Math.ceil((entry.bannedUntil - Date.now()) / 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Send-code rate limiter — public API
// ═══════════════════════════════════════════════════════════════════════════

const SEND_CODE_COOLDOWN_MS = 60_000; // 60 seconds

/** Check if this email (or its IP) is rate-limited for sending verification codes */
export function canSendCode(email: string, ip: string): { allowed: boolean; reason?: string } {
  const nk = normalize(email);
  const nip = normalize(ip);

  // Per-email cooldown
  const emailEntry = store.sendCode[nk];
  if (emailEntry && Date.now() - emailEntry.lastSentMs < SEND_CODE_COOLDOWN_MS) {
    return { allowed: false, reason: '请 60 秒后再重新发送验证码' };
  }

  // Per-IP cooldown (prevent mass sending to different emails from same IP)
  const ipEntry = store.sendCode[nip];
  if (ipEntry && Date.now() - ipEntry.lastSentMs < SEND_CODE_COOLDOWN_MS) {
    return { allowed: false, reason: '请稍后再试（发送频率过高）' };
  }

  return { allowed: true };
}

/** Record a successful verification code send */
export function recordCodeSend(email: string, ip: string): void {
  const now = Date.now();
  store.sendCode[normalize(email)] = { lastSentMs: now };
  store.sendCode[normalize(ip)] = { lastSentMs: now };
  saveStore();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Config
// ═══════════════════════════════════════════════════════════════════════════

export function getIpLimitConfig() {
  return {
    enabled: isEnabled(),
    threshold: getThreshold(),
    duration: Math.round(getDurationMs() / 1000),
  };
}

export function setIpLimitConfig(enabled: boolean, threshold: number, duration: number): void {
  if (enabled !== undefined) setSetting('ip_limit_enabled', enabled ? '1' : '0');
  if (typeof threshold === 'number' && threshold > 0) setSetting('ip_limit_threshold', String(threshold));
  if (typeof duration === 'number' && duration > 0) setSetting('ip_limit_duration', String(duration));
}

/**
 * SMTP email service for login verification codes.
 *
 * Configuration via database (SettingsPage) or environment variables:
 *   SMTP_HOST     — SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT     — SMTP server port (default: 587)
 *   SMTP_SECURE   — Use TLS immediately (default: false, uses STARTTLS on 587)
 *   SMTP_USER     — SMTP auth username (usually the email address)
 *   SMTP_PASS     — SMTP auth password or app-specific password
 *   SMTP_FROM     — "From" display name (default: "FreeLLMAPI")
 *   TWO_FACTOR_VERIFY_SENDER — Override the "From" email address
 */

import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import { getDb, getSetting, setSetting } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';

// ── SMTP config ──────────────────────────────────────────────────────────

export function getSmtpConfig() {
  const dbConfig = getSmtpConfigFromDb();
  const host = dbConfig.host || process.env.SMTP_HOST?.trim();
  if (!host) return null;

  // Check if Outlook OAuth is configured
  const oauthProvider = getSetting('smtp_oauth_provider');
  const oauthToken = oauthProvider === 'microsoft' ? getOAuthAccessToken() : null;

  return {
    host,
    port: dbConfig.port || Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: dbConfig.user || process.env.SMTP_USER?.trim() || '',
    pass: dbConfig.pass || process.env.SMTP_PASS?.trim() || '',
    from: process.env.TWO_FACTOR_VERIFY_SENDER?.trim() || dbConfig.from || process.env.SMTP_USER?.trim() || '',
    fromName: process.env.SMTP_FROM?.trim() || 'FreeLLMAPI',
    oauthToken,
    oauthProvider,
  };
}

export function getSmtpConfigFromDb() {
  const rawPass = getSetting('smtp_pass') || '';
  let pass = '';
  if (rawPass) {
    // Try to decrypt; if it fails the value is either plaintext (legacy)
    // or already being migrated.  Encrypted values are stored as
    // "enc:<encrypted>:<iv>:<authTag>".
    try {
      pass = decryptSmtpPassword(rawPass);
    } catch {
      // Plaintext fallback — re-encrypt for future reads.
      pass = rawPass;
    }
  }

  return {
    host: getSetting('smtp_host') || '',
    port: Number(getSetting('smtp_port')) || 0,
    user: getSetting('smtp_user') || '',
    pass,
    from: getSetting('smtp_from') || '',
  };
}

export function isSmtpConfigured(): boolean {
  const cfg = getSmtpConfig();
  return !!(cfg && cfg.host && cfg.user && cfg.pass);
}

// ── OAuth helpers ──────────────────────────────────────────────────────

/**
 * Retrieve a valid OAuth access token for the configured provider.
 * Returns null if no OAuth token is configured or it has expired without a
 * refresh token.
 */
function getOAuthAccessToken(): string | null {
  const provider = getSetting('smtp_oauth_provider');
  if (provider !== 'microsoft') return null;

  const rawAccess = getSetting('oauth_outlook_access_token');
  const expiryStr = getSetting('oauth_outlook_token_expiry');
  if (!rawAccess) return null;

  // Check if token is still valid (with 5-minute buffer)
  if (expiryStr && Number(expiryStr) > Date.now() + 5 * 60 * 1000) {
    try {
      const parts = rawAccess.split(':');
      if (parts.length >= 3) {
        return decrypt(parts[0], parts[1], parts[2]);
      }
      return rawAccess;
    } catch {
      return rawAccess;
    }
  }

  // Token expired — try refresh
  const rawRefresh = getSetting('oauth_outlook_refresh_token');
  if (!rawRefresh) {
    // Mark as expired
    return null;
  }

  // Synchronous refresh for SMTP — since sendMail is already async but
  // we can't easily await here in a getter. Instead, sendMailViaSmtp will
  // handle the fallback to null token case (which means OAuth won't be used
  // and SMTP will try AUTH LOGIN instead).
  //
  // For the initial implementation, we return null to fall through to
  // standard SMTP auth if the token is expired. A future enhancement can
  // add an async refresh trigger.
  return null;
}

/**
 * Refresh the Microsoft OAuth access token using the stored refresh token.
 * Returns the new access token, or null if refresh fails.
 */
async function refreshMicrosoftToken(): Promise<string | null> {
  const rawRefresh = getSetting('oauth_outlook_refresh_token');
  if (!rawRefresh) return null;

  let refreshToken: string;
  try {
    const parts = rawRefresh.split(':');
    if (parts.length >= 3) {
      refreshToken = decrypt(parts[0], parts[1], parts[2]);
    } else {
      refreshToken = rawRefresh;
    }
  } catch {
    return null;
  }

  try {
    const res = await fetch('https://login.live.com/oauth20_token.srf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '3dfac626-81f7-463e-8c32-e03dc0e1af95',
        grant_type: 'refresh_token',
        redirect_uri: 'https://login.live.com/oauth20_desktop.srf',
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[SMTP] OAuth refresh failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Store new tokens
    const { encrypted, iv, authTag } = encrypt(data.access_token);
    setSetting('oauth_outlook_access_token', `${encrypted}:${iv}:${authTag}`);
    setSetting('oauth_outlook_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));

    if (data.refresh_token) {
      const { encrypted: encR, iv: ivR, authTag: tagR } = encrypt(data.refresh_token);
      setSetting('oauth_outlook_refresh_token', `${encR}:${ivR}:${tagR}`);
    }

    return data.access_token;
  } catch (err) {
    console.warn(`[SMTP] OAuth refresh error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Serialize encrypted SMTP password for storage in settings table.
 * Format: "enc:<encrypted>:<iv>:<authTag>"
 */
export function encryptSmtpPassword(plaintext: string): string {
  const { encrypted, iv, authTag } = encrypt(plaintext);
  return `enc:${encrypted}:${iv}:${authTag}`;
}

/**
 * Deserialize and decrypt an SMTP password from settings storage.
 * Throws if the value doesn't match the encrypted format or decryption fails.
 */
function decryptSmtpPassword(stored: string): string {
  if (!stored.startsWith('enc:')) {
    throw new Error('not encrypted');
  }
  const parts = stored.slice(4).split(':');
  if (parts.length < 3) throw new Error('invalid format');
  const [encKey, iv, authTag] = parts;
  return decrypt(encKey, iv, authTag);
}

// ── Logging ──────────────────────────────────────────────────────────────

function smtpLog(msg: string): void {
  const enabled = getSetting('smtp_log_enabled') !== '0';
  if (enabled) {
    console.log(`[SMTP] ${msg}`);
  }
}

function smtpLogCode(code: string): void {
  const showCode = getSetting('smtp_log_show_code') !== '0';
  if (showCode) {
    console.log(`[SMTP] 验证码: ${code}`);
  } else {
    console.log(`[SMTP] 验证码已生成（已隐藏，可在设置中开启显示）`);
  }
}

// ── Verification code ────────────────────────────────────────────────────

/** In-memory counter of consecutive failed attempts per email. */
const failedAttempts = new Map<string, number>();
const MAX_FAILED_ATTEMPTS = 5;

/**
 * Generate a 6-digit verification code, store it in DB, and send via SMTP.
 * Returns the code hash for verification. Expires in 5 minutes.
 */
export async function sendVerificationCode(email: string): Promise<{ success: boolean; error?: string }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    smtpLog('发送失败：SMTP 未配置');
    return { success: false, error: 'SMTP 未配置，请先设置 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS 环境变量' };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  smtpLogCode(code);

  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;

  const db = getDb();
  db.prepare('DELETE FROM verification_codes WHERE email = ? AND expires_at_ms < ?').run(email, Date.now());

  // Reset failed attempts counter on new code send
  failedAttempts.delete(email);

  db.prepare('INSERT INTO verification_codes (email, code_hash, expires_at_ms) VALUES (?, ?, ?)').run(email, codeHash, expiresAt);

  const subject = `FreeLLMAPI 登录验证码：${code}`;
  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">FreeLLMAPI 双重验证</h2>
  <p>您好，</p>
  <p>您的登录验证码是：</p>
  <div style="font-size: 32px; font-weight: bold; text-align: center; padding: 16px;
              background: #f0f4ff; border-radius: 8px; letter-spacing: 8px; margin: 16px 0;">
    ${code}
  </div>
  <p style="color: #666;">此验证码 5 分钟内有效。如非本人操作，请忽略此邮件。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
  <p style="font-size: 12px; color: #999;">此邮件由 FreeLLMAPI 系统自动发送，请勿回复。</p>
</div>`;

  try {
    smtpLog(`开始发送邮件到 ${email}，连接 ${cfg.host}:${cfg.port} (secure=${cfg.secure})`);
    await sendMailViaSmtp(cfg, email, subject, htmlBody);
    smtpLog(`邮件发送成功 → ${email}`);
    return { success: true };
  } catch (err: any) {
    smtpLog(`邮件发送失败: ${err.message}`);
    db.prepare('DELETE FROM verification_codes WHERE email = ? AND code_hash = ?').run(email, codeHash);
    return { success: false, error: `邮件发送失败：${err.message}` };
  }
}

/**
 * Verify a submitted code for the given email. Returns true if valid.
 * After MAX_FAILED_ATTEMPTS consecutive failed attempts, all codes for
 * the email are invalidated.
 */
export function verifyCode(email: string, code: string): boolean {
  const db = getDb();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const row = db.prepare(
    'SELECT id, expires_at_ms FROM verification_codes WHERE email = ? AND code_hash = ? AND expires_at_ms > ? ORDER BY id DESC LIMIT 1'
  ).get(email, codeHash, Date.now()) as { id: number } | undefined;

  if (!row) {
    // Increment failed attempts counter
    const attempts = (failedAttempts.get(email) || 0) + 1;
    failedAttempts.set(email, attempts);

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      smtpLog(`验证码连续 ${attempts} 次尝试失败，已锁定 ${email} 的所有验证码`);
      db.prepare('DELETE FROM verification_codes WHERE email = ?').run(email);
      failedAttempts.delete(email);
    }
    return false;
  }

  // Valid code — reset counter
  failedAttempts.delete(email);
  db.prepare('DELETE FROM verification_codes WHERE id = ?').run(row.id);
  return true;
}

// ── Raw SMTP client ──────────────────────────────────────────────────────

interface SmtpSocket extends net.Socket {
  _smtpBuffer?: string;
}

function readResponse(socket: SmtpSocket): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    socket._smtpBuffer = socket._smtpBuffer || '';

    function onData(data: Buffer) {
      socket._smtpBuffer! += data.toString();

      // Parse complete lines
      const lines = socket._smtpBuffer!.split('\r\n');
      // Keep the last (possibly incomplete) segment in buffer
      socket._smtpBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line || line.length < 4) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (isNaN(code)) continue;
        // Multi-line response (code-dash)
        if (line[3] === '-') continue;

        // Single-line or end of multi-line
        socket.removeListener('data', onData);
        const text = line.slice(4);
        smtpLog(`← ${code} ${text}`);
        resolve({ code, text });
        return;
      }
    }

    socket.on('data', onData);
  });
}

function sendCommand(socket: SmtpSocket, cmd: string): void {
  smtpLog(`→ ${cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd}`);
  socket.write(cmd + '\r\n');
}

async function upgradeToTls(socket: SmtpSocket, host: string): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: false,
    }) as SmtpSocket;

    tlsSocket.on('secureConnect', () => {
      smtpLog('TLS 升级完成');
      tlsSocket._smtpBuffer = '';
      resolve(tlsSocket);
    });
    tlsSocket.on('error', reject);
  });
}

export async function sendMailViaSmtp(
  cfg: { host: string; port: number; secure: boolean; user: string; pass: string; from: string; fromName: string; oauthToken?: string | null; oauthProvider?: string },
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  let socket: SmtpSocket;
  let oauthToken = cfg.oauthToken ?? null;

  // If OAuth token is expired, try async refresh before connecting
  if (cfg.oauthProvider === 'microsoft' && !oauthToken) {
    oauthToken = await refreshMicrosoftToken();
  }

  // ── Connect ──────────────────────────────────────────────────────────
  if (cfg.secure) {
    socket = tls.connect(cfg.port, cfg.host, { rejectUnauthorized: false }) as SmtpSocket;
    await new Promise<void>((resolve, reject) => {
      (socket as tls.TLSSocket).once('secureConnect', resolve);
      socket.once('error', reject);
    });
    smtpLog(`TLS 直连成功 ${cfg.host}:${cfg.port}`);
    socket._smtpBuffer = '';
  } else {
    socket = net.connect(cfg.port, cfg.host) as SmtpSocket;
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    smtpLog(`TCP 连接成功 ${cfg.host}:${cfg.port}`);
    socket._smtpBuffer = '';
  }

  try {
    // ── Greeting ───────────────────────────────────────────────────────
    const greeting = await readResponse(socket);
    if (greeting.code >= 400) throw new Error(`SMTP greeting error: ${greeting.text}`);

    // ── EHLO ───────────────────────────────────────────────────────────
    sendCommand(socket, 'EHLO freellmapi');
    const ehlo = await readResponse(socket);
    if (ehlo.code >= 400) throw new Error(`EHLO failed: ${ehlo.text}`);

    // ── STARTTLS (only for non-secure connections) ─────────────────────
    if (!cfg.secure) {
      sendCommand(socket, 'STARTTLS');
      const starttlsResp = await readResponse(socket);
      if (starttlsResp.code >= 400) throw new Error(`STARTTLS failed: ${starttlsResp.text}`);

      socket = await upgradeToTls(socket, cfg.host);

      // Re-EHLO after TLS upgrade
      sendCommand(socket, 'EHLO freellmapi');
      const ehlo2 = await readResponse(socket);
      if (ehlo2.code >= 400) throw new Error(`EHLO after TLS failed: ${ehlo2.text}`);
    }

    // ── AUTH ─────────────────────────────────────────────────────────────
    if (oauthToken) {
      // XOAUTH2 for Microsoft/Outlook
      const xoauth2 = Buffer.from(`user=${cfg.user}\x01auth=Bearer ${oauthToken}\x01\x01`).toString('base64');
      sendCommand(socket, 'AUTH XOAUTH2 ' + xoauth2);
      const oauthResp = await readResponse(socket);
      if (oauthResp.code >= 400) {
        // XOAUTH2 may return a challenge on failure; consume it if present
        throw new Error(`XOAUTH2 failed: ${oauthResp.text}`);
      }
      smtpLog('XOAUTH2 认证成功');
    } else {
      // Standard AUTH LOGIN
      sendCommand(socket, 'AUTH LOGIN');
      const authResp = await readResponse(socket);
      if (authResp.code !== 334) throw new Error(`AUTH LOGIN unexpected: ${authResp.text}`);

      sendCommand(socket, Buffer.from(cfg.user).toString('base64'));
      const userResp = await readResponse(socket);
      if (userResp.code !== 334) throw new Error(`AUTH user failed: ${userResp.text}`);

      sendCommand(socket, Buffer.from(cfg.pass).toString('base64'));
      const passResp = await readResponse(socket);
      if (passResp.code >= 400) throw new Error(`AUTH password failed: ${passResp.text}`);
      smtpLog('SMTP 认证成功');
    }

    // ── MAIL FROM ──────────────────────────────────────────────────────
    const fromAddr = cfg.from || cfg.user;
    sendCommand(socket, `MAIL FROM:<${fromAddr}>`);
    const mailFromResp = await readResponse(socket);
    if (mailFromResp.code >= 400) throw new Error(`MAIL FROM failed: ${mailFromResp.text}`);

    // ── RCPT TO ────────────────────────────────────────────────────────
    sendCommand(socket, `RCPT TO:<${to}>`);
    const rcptResp = await readResponse(socket);
    if (rcptResp.code >= 400) throw new Error(`RCPT TO failed: ${rcptResp.text}`);

    // ── DATA ───────────────────────────────────────────────────────────
    sendCommand(socket, 'DATA');
    const dataResp = await readResponse(socket);
    if (dataResp.code !== 354) throw new Error(`DATA unexpected: ${dataResp.text}`);

    // ── Send mail content ──────────────────────────────────────────────
    const mailContent = [
      `From: "${cfg.fromName}" <${fromAddr}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="FreeLLMAPI_boundary"`,
      '',
      '--FreeLLMAPI_boundary',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html.replace(/<[^>]*>/g, '')).toString('base64'),
      '',
      '--FreeLLMAPI_boundary',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html).toString('base64'),
      '',
      '--FreeLLMAPI_boundary--',
      '.',
    ].join('\r\n');

    sendCommand(socket, mailContent);
    const sendResp = await readResponse(socket);
    if (sendResp.code >= 400) throw new Error(`Mail send failed: ${sendResp.text}`);

    // ── QUIT ───────────────────────────────────────────────────────────
    sendCommand(socket, 'QUIT');
    socket.end();
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

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
import { getDb, getSetting } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';

// ── SMTP config ──────────────────────────────────────────────────────────

function getSmtpConfig() {
  const dbConfig = getSmtpConfigFromDb();
  const host = dbConfig.host || process.env.SMTP_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: dbConfig.port || Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: dbConfig.user || process.env.SMTP_USER?.trim() || '',
    pass: dbConfig.pass || process.env.SMTP_PASS?.trim() || '',
    from: process.env.TWO_FACTOR_VERIFY_SENDER?.trim() || dbConfig.from || process.env.SMTP_USER?.trim() || '',
    fromName: process.env.SMTP_FROM?.trim() || 'FreeLLMAPI',
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

// ── SMTP password encryption helpers ────────────────────────────────────

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

async function sendMailViaSmtp(
  cfg: { host: string; port: number; secure: boolean; user: string; pass: string; from: string; fromName: string },
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  let socket: SmtpSocket;

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

    // ── AUTH LOGIN ─────────────────────────────────────────────────────
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

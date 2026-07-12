/**
 * SMTP email service for email verification on login.
 *
 * Configuration stored in DB (set via Settings page):
 *   smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
 */

import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import { getDb, getSetting } from '../db/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[SMTP ${ts}] ${msg}`);
}

function logCode(email: string, code: string) {
  if (getSetting('smtp_log_show_code') !== '0') {
    log(`验证码 → ${email}: ${code}`);
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

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
  return {
    host: getSetting('smtp_host') || '',
    port: Number(getSetting('smtp_port')) || 0,
    user: getSetting('smtp_user') || '',
    pass: getSetting('smtp_pass') || '',
    from: getSetting('smtp_from') || '',
  };
}

export function isSmtpConfigured(): boolean {
  const cfg = getSmtpConfig();
  return !!(cfg && cfg.host && cfg.user && cfg.pass);
}

// ─── Verification Code ──────────────────────────────────────────────────────

export async function sendVerificationCode(email: string): Promise<{ success: boolean; error?: string }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    log('发送失败：SMTP 未配置');
    return { success: false, error: 'SMTP 未配置' };
  }

  log(`准备向 ${email} 发送验证码（服务器 ${cfg.host}:${cfg.port}）`);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000;

  const db = getDb();
  db.prepare('DELETE FROM verification_codes WHERE email = ? AND expires_at_ms < ?').run(email, Date.now());
  db.prepare('INSERT INTO verification_codes (email, code_hash, expires_at_ms) VALUES (?, ?, ?)').run(email, codeHash, expiresAt);

  logCode(email, code);

  const subject = `FreeLLMAPI 登录验证码：${code}`;
  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">FreeLLMAPI 登录验证</h2>
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
    await sendMailViaSmtp(cfg, email, subject, htmlBody);
    log(`验证码已成功发送至 ${email}`);
    return { success: true };
  } catch (err: any) {
    log(`发送失败: ${err.message}`);
    db.prepare('DELETE FROM verification_codes WHERE email = ? AND code_hash = ?').run(email, codeHash);
    return { success: false, error: `邮件发送失败：${err.message}` };
  }
}

export function verifyCode(email: string, code: string): boolean {
  const db = getDb();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const row = db.prepare(
    'SELECT id, expires_at_ms FROM verification_codes WHERE email = ? AND code_hash = ? AND expires_at_ms > ? ORDER BY id DESC LIMIT 1'
  ).get(email, codeHash, Date.now()) as { id: number } | undefined;

  if (!row) return false;
  db.prepare('DELETE FROM verification_codes WHERE id = ?').run(row.id);
  return true;
}

// ─── Raw SMTP Client (proper state machine) ──────────────────────────────────

type SmtpConfig = ReturnType<typeof getSmtpConfig> & {};

async function sendMailViaSmtp(
  cfg: NonNullable<SmtpConfig>,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const fromAddr = cfg.from || cfg.user;

  // Build the full email body
  const boundary = `FreeLLMAPI_${Date.now()}`;
  const textBody = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const mailContent = [
    `From: "${cfg.fromName}" <${fromAddr}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textBody).toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html).toString('base64'),
    '',
    `--${boundary}--`,
    '.',
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    let socket: net.Socket;
    let buffer = '';
    let upgraded = false;

    function connect() {
      log(`连接 ${cfg.host}:${cfg.port} (${cfg.secure ? 'TLS' : 'STARTTLS'})`);
      if (cfg.secure) {
        socket = tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: false }, () => {
          log('TLS 握手完成');
          startSession();
        });
      } else {
        socket = net.connect(cfg.port, cfg.host, () => {
          log('TCP 连接成功');
        });
      }
      socket.setEncoding('utf8');
      socket.on('data', (data: string) => onData(data));
      socket.on('error', (err: Error) => {
        log(`连接错误: ${err.message}`);
        reject(err);
      });
      socket.on('close', () => {
        if (!upgraded) log('连接已关闭');
      });
    }

    // Sends a command and returns the next response via callback
    type StepFn = (code: number, msg: string) => void;
    let nextStep: StepFn | null = null;
    let responseBuf = '';

    function onData(data: string) {
      buffer += data;
      const lines = buffer.split('\r\n');
      // Keep the incomplete last part in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line || line.length < 3) continue;
        // Multi-line response continuation (e.g., "250-SIZE ...")
        if (line[3] === '-') {
          log(`  ← ${line}`);
          continue;
        }

        const code = parseInt(line.slice(0, 3), 10);
        if (isNaN(code)) continue;

        log(`  ← ${line}`);

        if (code >= 400) {
          socket.destroy();
          reject(new Error(`SMTP ${code}: ${line.slice(4)}`));
          return;
        }

        const cb = nextStep;
        nextStep = null;
        if (cb) cb(code, line);
      }
    }

    function sendCmd(cmd: string, onResp: StepFn) {
      const displayCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      log(`  → ${displayCmd}`);
      nextStep = onResp;
      socket.write(cmd + '\r\n');
    }

    function startSession() {
      // Step 1: Wait for greeting (220), send EHLO
      nextStep = (_code, _msg) => {
        sendCmd(`EHLO freellmapi`, (_code2, _msg2) => {
          if (!cfg.secure && !upgraded) {
            // Step 2: STARTTLS
            sendCmd('STARTTLS', (_code3, _msg3) => {
              log('升级到 TLS...');
              upgraded = true;
              socket.removeAllListeners('data');
              socket = tls.connect({
                socket: socket,
                rejectUnauthorized: false,
              }, () => {
                log('TLS 升级完成');
                socket.setEncoding('utf8');
                socket.on('data', (d: string) => onData(d));
                // Re-send EHLO over TLS
                sendCmd('EHLO freellmapi', onEhloDone);
              });
              socket.on('error', (err: Error) => {
                log(`TLS 升级错误: ${err.message}`);
                reject(err);
              });
            });
          } else {
            onEhloDone(250, 'OK');
          }
        });
      };
    }

    function onEhloDone(_code: number, _msg: string) {
      // Step 3: AUTH LOGIN
      sendCmd('AUTH LOGIN', (_c, _m) => {
        sendCmd(Buffer.from(cfg.user).toString('base64'), (_c2, _m2) => {
          sendCmd(Buffer.from(cfg.pass).toString('base64'), (_c3, _m3) => {
            // Step 4: MAIL FROM
            sendCmd(`MAIL FROM:<${fromAddr}>`, (_c4, _m4) => {
              // Step 5: RCPT TO
              sendCmd(`RCPT TO:<${to}>`, (_c5, _m5) => {
                // Step 6: DATA
                sendCmd('DATA', (_c6, _m6) => {
                  // Step 7: Send email body
                  sendCmd(mailContent, (_c7, _m7) => {
                    // Step 8: QUIT
                    sendCmd('QUIT', () => {
                      log('邮件发送完成');
                      socket.end();
                      resolve();
                    });
                  });
                });
              });
            });
          });
        });
      });
    }

    connect();
  });
}

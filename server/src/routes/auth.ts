import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  userCount,
  createUser,
  verifyCredentials,
  createSession,
  validateSession,
  deleteSession,
  destroyUserSessions,
} from '../services/auth.js';
import { isSmtpConfigured, sendVerificationCode, verifyCode } from '../services/smtp.js';
import { setupCodeMatches, clearSetupCode } from '../lib/setup-code.js';
import { getSetting } from '../db/index.js';
import {
  getClientIp,
  isIpBanned,
  recordIpFailure,
  clearIpFailures,
  getIpBanRemainingSeconds,
  isEmailBanned,
  recordEmailFailure,
  clearEmailFailures,
  getEmailBanRemainingSeconds,
  canSendCode,
  recordCodeSend,
  getIpLimitConfig,
} from '../services/ip-rate-limiter.js';

export const authRouter = Router();

// Dashboard auth (#35). These routes are mounted BEFORE requireAuth, so
// /status, /setup and /login are reachable without a session (bootstrap);
// /logout and /me validate the token themselves.

const credentialsSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string()
    .min(8, '密码长度至少 8 位')
    .regex(/[a-z]/, '密码需包含小写字母')
    .regex(/[A-Z]/, '密码需包含大写字母')
    .regex(/[0-9]/, '密码需包含数字'),
});

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * CSRF protection for mutation endpoints.
 * Auth uses Authorization: Bearer header (not cookies), so cookie-based CSRF
 * is not directly exploitable.  However, an attacker can still craft a
 * cross-site form POST to our mutation endpoints.  Requiring a custom header
 * (which browsers forbid cross-origin without CORS preflight) blocks those
 * requests.
 */
function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const customHeader =
    req.headers['x-requested-with'] ||
    req.headers['x-csrf-token'];
  if (!customHeader) {
    res.status(403).json({
      error: { message: 'Missing X-Requested-With or X-CSRF-Token header', type: 'csrf_error' },
    });
    return;
  }
  next();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bearer(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
}

// Is the caller connecting from the local machine? We check the actual socket
// peer address, NOT req.ip or X-Forwarded-For: those are attacker-controlled
// behind a proxy (and trust proxy is off by default anyway), so trusting them
// here would let a remote caller pretend to be local and skip the setup code.
function isLoopbackRemote(req: Request): boolean {
  let addr = req.socket.remoteAddress ?? '';
  // Node reports IPv4 loopback over a dual-stack socket as "::ffff:127.0.0.1".
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (addr === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

// Has the dashboard been set up yet, and is this caller authenticated?
authRouter.get('/status', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  const smtpConfigured = isSmtpConfigured();
  const smtpEnabled = smtpConfigured && getSetting('smtp_enabled') !== '0';
  res.json({
    needsSetup: userCount() === 0,
    authenticated: !!session,
    email: session?.email ?? null,
    smtpEnabled,
    smtpConfigured,
  });
});

// First-run account creation. Only allowed while there are zero users, so it
// can't be used to add accounts once the dashboard is claimed.
authRouter.post('/setup', csrfGuard, (req: Request, res: Response) => {
  if (userCount() > 0) {
    clearSetupCode();
    res.status(409).json({ error: { message: '初始化已完毕，请直接登录。', type: 'setup_complete' } });
    return;
  }

  // Local/desktop first-run stays frictionless: a browser on this machine can
  // claim the dashboard without any code. A remote caller must present the
  // one-time setup code logged at boot, so an exposed fresh install can't be
  // claimed by a stranger who finds it first.
  if (!isLoopbackRemote(req) && !setupCodeMatches((req.body ?? {}).setupCode)) {
    res.status(403).json({
      error: {
        message: '远程设备创建首个账号需要设置码。' +
          '请在服务端启动日志中查看一次性设置码，或从本机浏览器打开仪表盘。',
        type: 'setup_code_required',
      },
    });
    return;
  }

  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const user = createUser(parsed.data.email, parsed.data.password);
  clearSetupCode(); // one-time: the dashboard is now claimed
  const token = createSession(user.userId);
  res.status(201).json({ token, email: user.email });
});

// Send email verification code: POST /api/auth/login/send-code
// Uses persisted dual-layer rate limiting (per-email + per-IP) instead of the
// old in-memory Map (which reset on restart and had no IP dimension).
authRouter.post('/login/send-code', csrfGuard, async (req: Request, res: Response) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email) {
    res.status(400).json({ error: { message: '请提供邮箱地址' } });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const clientIp = getClientIp(req);

  // Persisted rate limiter — both per-email and per-IP
  const check = canSendCode(normalizedEmail, clientIp);
  if (!check.allowed) {
    res.status(429).json({ error: { message: check.reason || '发送频率过高，请稍后再试' } });
    return;
  }

  const result = await sendVerificationCode(normalizedEmail);
  if (!result.success) {
    res.status(500).json({ error: { message: result.error || '发送验证码失败' } });
    return;
  }
  recordCodeSend(normalizedEmail, clientIp);
  res.json({ success: true, message: '验证码已发送' });
});

authRouter.post('/login', (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const { email, password } = parsed.data;
  const code = (req.body as { code?: string }).code;
  const clientIp = getClientIp(req);

  // IP + email dual-layer rate limiting
  const ipLimitConfig = getIpLimitConfig();
  if (ipLimitConfig.enabled) {
    if (isIpBanned(clientIp)) {
      const remaining = getIpBanRemainingSeconds(clientIp);
      res.status(429).json({
        error: {
          message: `登录尝试次数过多，该 IP 已被临时封禁，请 ${Math.ceil(remaining / 60)} 分钟后再试。`,
          type: 'ip_rate_limit_error',
        },
      });
      return;
    }
    if (isEmailBanned(email)) {
      const remaining = getEmailBanRemainingSeconds(email);
      res.status(429).json({
        error: {
          message: `该账号登录尝试次数过多，已被临时锁定，请 ${Math.ceil(remaining / 60)} 分钟后再试。`,
          type: 'account_rate_limit_error',
        },
      });
      return;
    }
  }

  const user = verifyCredentials(email, password);
  if (!user) {
    if (ipLimitConfig.enabled) {
      recordIpFailure(clientIp);
      recordEmailFailure(email);
    }
    res.status(401).json({ error: { message: '邮箱或密码错误', type: 'authentication_error' } });
    return;
  }

  if (ipLimitConfig.enabled) {
    clearIpFailures(clientIp);
    clearEmailFailures(email);
  }

  // Check if SMTP email verification is configured AND enabled
  const smtpEnabled = getSetting('smtp_enabled') !== '0';
  if (isSmtpConfigured() && smtpEnabled) {
    if (!code) {
      res.status(400).json({ error: { message: '请输入邮箱验证码', type: 'verification_code_required' } });
      return;
    }
    if (!verifyCode(email, code)) {
      res.status(401).json({ error: { message: '验证码错误或已过期', type: 'authentication_error' } });
      return;
    }
  }

  // Destroy all old sessions (single session per user — prevents session
  // accumulation on consecutive logins)
  destroyUserSessions(user.userId);
  const token = createSession(user.userId);
  res.json({ token, email: user.email });
});

authRouter.post('/logout', csrfGuard, (req: Request, res: Response) => {
  deleteSession(bearer(req));
  res.json({ success: true });
});

authRouter.get('/me', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  if (!session) {
    res.status(401).json({ error: { message: '需要身份验证', type: 'authentication_error' } });
    return;
  }
  res.json({ email: session.email });
});

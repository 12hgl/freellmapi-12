# FreeLLMAPI-12

**Security-hardened fork of [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** — one OpenAI-compatible `/v1` endpoint aggregating 18 free LLM providers behind a smart router with per-key rate-limit tracking.

> Forked from [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) (MIT License). This fork adds production-grade security hardening while maintaining full upstream compatibility.

## Security Hardening (vs upstream)

| Category | Improvement |
|---|---|
| **Password Hashing** | Upgraded to scrypt (N=2^17) with pepper — resistant to GPU/ASIC brute-force |
| **API Key Storage** | AES-256-GCM encrypted at rest (was plaintext in upstream) |
| **SMTP Password** | AES-256-GCM encrypted at rest |
| **Session Security** | CSRF token validation on all state-changing endpoints |
| **Rate Limiting** | Per-IP and per-account rate limiting with configurable thresholds |
| **CSP Headers** | Strict Content-Security-Policy via helmet, preventing XSS and injection |
| **Timing Attacks** | Constant-time comparison for sensitive tokens (password, API key verification) |
| **Database Migrations** | All schema migrations properly registered and versioned |

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name freellmapi-12 \
  -p 3739:3739 \
  -v freellmapi-data:/app/server/data \
  -e ADMIN_EMAIL=your@email.com \
  -e ADMIN_PASSWORD=your-password \
  ghcr.io/12hgl/freellmapi-12:latest
```

Then visit `http://localhost:3739`.

### From Source

```bash
git clone https://github.com/12hgl/freellmapi-12.git
cd freellmapi-12
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_EMAIL` | Yes | Admin account email |
| `ADMIN_PASSWORD` | Yes | Admin account password (min 8 chars) |
| `ENCRYPTION_KEY` | No | 64-char hex key for encrypting API keys and SMTP passwords (auto-generated if omitted) |
| `PEPPER` | No | Additional secret for password hashing (auto-generated if omitted) |
| `PORT` | No | Server port (default: 3739) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | No | SMTP for password reset emails |

See `.env.example` for all options.

## Architecture

```
Client → /v1/chat/completions → Router → [Provider A] → [Provider B] → ... → Response
                                         ↓ (rate-limited or error)
                                    Fallback chain with per-provider token budgets
```

Supports 18 providers: Google Gemini, Groq, Cerebras, NVIDIA NIM, Mistral, OpenRouter, GitHub Models, Cohere, Cloudflare Workers AI, HuggingFace, Z.ai (Zhipu), Ollama, Kilo, Pollinations, LLM7, OVH AI Endpoints, OpenCode Zen, AI Horde.

## License

MIT — see [LICENSE](./LICENSE). Original work copyright Tashfeen Ahmed; modifications copyright 12hgl.

## Upstream

This project is a security-hardened fork. For the original project, see [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi).

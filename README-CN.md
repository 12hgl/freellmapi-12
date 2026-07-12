# FreeLLMAPI-12

**基于 [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) 的安全加固分支** — 聚合 18 个免费 LLM 供应商的 OpenAI 兼容 `/v1` 端点，内置智能路由和按密钥速率限制追踪。

> 派生自 [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi)（MIT 协议）。本分支在保持完全上游兼容的同时，增加了生产级安全加固。

## 安全加固（相比上游）

| 类别 | 改进 |
|---|---|
| **密码哈希** | 升级至 scrypt (N=2^17) 加 pepper — 抵抗 GPU/ASIC 暴力破解 |
| **API 密钥存储** | AES-256-GCM 静态加密（上游为明文存储） |
| **SMTP 密码** | AES-256-GCM 静态加密 |
| **会话安全** | 所有状态变更端点均强制 CSRF 令牌校验 |
| **速率限制** | 每 IP 和每账户速率限制，阈值可配置 |
| **CSP 标头** | 通过 helmet 启用严格的 Content-Security-Policy，防范 XSS 和注入 |
| **时序攻击** | 敏感令牌（密码、API 密钥验证）采用恒定时间比较 |
| **数据库迁移** | 所有 schema 迁移均已正确注册和版本化 |

## 快速开始

### Docker 部署（推荐）

详见 **[Docker 部署指南 (中文)](./DOCKER_DEPLOY.md)**

```bash
docker run -d \
  --name freellmapi-12 \
  -p 3739:3739 \
  -v freellmapi-data:/app/server/data \
  -e ADMIN_EMAIL=your@email.com \
  -e ADMIN_PASSWORD=your-password \
  ghcr.io/12hgl/freellmapi-12:latest
```

然后访问 `http://localhost:3739`。

### 源码部署

```bash
git clone https://github.com/12hgl/freellmapi-12.git
cd freellmapi-12
npm install
npm run build
npm start
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_EMAIL` | 是 | 管理员账户邮箱 |
| `ADMIN_PASSWORD` | 是 | 管理员密码（最少 8 位） |
| `ENCRYPTION_KEY` | 否 | 64 位十六进制密钥，用于加密 API 密钥和 SMTP 密码（留空则自动生成） |
| `PEPPER` | 否 | 密码哈希的额外密钥（留空则自动生成） |
| `PORT` | 否 | 服务端口（默认 3739） |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | 否 | 用于密码重置邮件的 SMTP 配置 |

完整配置参见 `.env.example`。

## 架构

```
客户端 → /v1/chat/completions → 路由器 → [供应商 A] → [供应商 B] → ... → 响应
                                         ↓（速率限制或错误）
                                    带每供应商令牌预算的降级链
```

支持 18 个供应商：Google Gemini、Groq、Cerebras、NVIDIA NIM、Mistral、OpenRouter、GitHub Models、Cohere、Cloudflare Workers AI、HuggingFace、Z.ai（智谱）、Ollama、Kilo、Pollinations、LLM7、OVH AI Endpoints、OpenCode Zen、AI Horde。

## 协议

MIT — 详见 [LICENSE](./LICENSE)。原始作品版权归 Tashfeen Ahmed 所有；修改部分版权归 12hgl。

## 上游

本项目的原始仓库为 [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi)。

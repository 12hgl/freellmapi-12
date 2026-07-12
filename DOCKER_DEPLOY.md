# Docker 部署指南

FreeLLMAPI-12 一键 Docker Compose 部署，支持 x86_64 和 ARM64。

## 环境要求

- Docker 20.10+
- Docker Compose v2

## 快速开始

### 1. 创建项目目录

```bash
mkdir freellmapi && cd freellmapi
```

### 2. 准备 docker-compose.yml

```yaml
services:
  freellmapi:
    image: ghcr.io/12hgl/freellmapi-12:latest
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 3001
    ports:
      - "${HOST_BIND:-127.0.0.1}:${PORT:-3001}:3001"
    volumes:
      - freellmapi-data:/app/server/data
    restart: unless-stopped
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3001/api/ping').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"
        ]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

volumes:
  freellmapi-data:
```

### 3. 创建 .env 配置文件

```bash
# 生成加密密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

将生成的 64 位十六进制字符串填入 `.env`：

```ini
# 必填 — 加密密钥
ENCRYPTION_KEY=你生成的64位十六进制密钥

# 可选 — 服务端口（默认 3001）
PORT=3001

# 可选 — Docker 端口绑定地址。默认 127.0.0.1 仅本机可访问；
# 如需局域网内其他设备访问，改为 0.0.0.0（仅限可信网络）
# HOST_BIND=0.0.0.0
```

完整可选配置参见仓库中的 `.env.example`。

### 4. 启动服务

```bash
docker compose up -d
```

查看启动日志：

```bash
docker compose logs -f
```

### 5. 首次登录

浏览器打开 `http://127.0.0.1:3001`，进入仪表盘后根据指引创建首个管理员账户。

## 镜像源

| 镜像源 | 地址 | 适用区域 |
|--------|------|----------|
| GitHub Container Registry | `ghcr.io/12hgl/freellmapi-12:latest` | 国际 |
| 阿里云 ACR | `crpi-gag05akfnletslye.cn-hangzhou.personal.cr.aliyuncs.com/12hgl/freellmapi-12:latest` | 国内 |

国内用户建议使用 ACR 镜像，将 `docker-compose.yml` 中的 `image` 替换为：

```yaml
image: crpi-gag05akfnletslye.cn-hangzhou.personal.cr.aliyuncs.com/12hgl/freellmapi-12:latest
```

## 升级

```bash
docker compose pull
docker compose up -d
```

## 数据持久化

数据库文件存储在命名卷 `freellmapi-data` 中，映射到容器的 `/app/server/data`。如需备份：

```bash
docker compose cp freellmapi:/app/server/data ./backup
```

## 健康检查

```bash
curl http://127.0.0.1:3001/api/ping
# 返回 {"status":"ok"}
```

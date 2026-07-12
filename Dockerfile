# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:20-alpine

# ── 依赖安装层 ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
  && apk add --no-cache python3 make g++ sqlite-dev \
  && ln -sf python3 /usr/bin/python

RUN --mount=type=cache,target=/root/.npm \
  npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN --mount=type=cache,target=/root/.npm \
  npm_config_disturl=https://registry.npmmirror.com/-/binary/node \
  npm ci --cache /root/.npm

# ── 构建层（分层 COPY 以最大化缓存命中）─────────────────────────────────
FROM deps AS build
WORKDIR /app

# 先拷配置（极少变动，缓存常驻）
COPY tsconfig*.json ./
COPY server/tsconfig.json ./server/tsconfig.json
COPY client/tsconfig*.json ./client/
COPY client/vite.config.* ./client/
COPY client/index.html ./client/

# 再拷共享代码
COPY shared/ ./shared/

# 最后拷业务源码（最常变动，仅这层失效时重编译）
COPY server/src/ ./server/src/
COPY client/src/ ./client/src/

RUN npm run build
RUN npm prune --omit=dev

# ── 运行层（最精简）───────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/client/dist ./client/dist

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data

USER node
EXPOSE 3001 3002
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/ping').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "server/dist/index.js"]

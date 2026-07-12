ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG APT_MIRROR=""
ARG NPM_CONFIG_REGISTRY=""

WORKDIR /app

ENV NODE_ENV=production
ENV ERP_PORT=3000

# better-sqlite3 是原生模块，保留编译工具能让不同 CPU/Node 版本下安装更稳。
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org/debian|$APT_MIRROR/debian|g; s|http://deb.debian.org/debian-security|$APT_MIRROR/debian-security|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN if [ -n "$NPM_CONFIG_REGISTRY" ]; then npm config set registry "$NPM_CONFIG_REGISTRY"; fi \
  && npm ci --omit=dev

COPY core ./core
COPY web ./web
COPY config ./config
COPY automation ./automation
COPY docs ./docs
COPY config.json README.md ./

RUN mkdir -p data uploads downloads reports state logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "erp"]

ARG NODE_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV TZ=Asia/Shanghai
EXPOSE 4180
CMD ["npm", "start"]

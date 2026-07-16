# NAS 拆包视频服务

该服务部署在飞牛 fnOS Docker 中，视频只在收到开始扫码命令后写入 NAS 的 `data/sessions/`，空闲时不会循环录制。云端 ERP 通过 HTTPS + HMAC 命令控制开始/结束，NAS 通过同一密钥回传视频索引；云端不会保存媒体文件。

每次会话会生成完整录像、开始扫码后前 5 秒的 `start_event`，以及完成扫码前后各约 5 秒的 `completion_event`。扫描完成条码后，服务会继续录制 5 秒再停止。

## 部署

1. 复制 `.env.example` 为 `.env`，填写与云端相同的 `UNPACK_NAS_SHARED_SECRET`。
2. 复制 `config/cameras.example.json` 为 `config/cameras.json`，填写海康 RTSP 或 NAS USB 摄像头来源。RTSP 密码只保存在 NAS。
3. USB 摄像头先在 fnOS 中确认设备路径，例如 `/dev/video0`；如不是该路径，同时修改 `docker-compose.yml` 的 `devices`。
4. 执行 `docker compose up -d --build`，再访问 `http://NAS内网IP:4180/health` 检查容器。

## video.lttlt.top

Nginx 反向代理只暴露服务 API；视频文件不要直接映射为可猜测的静态路径。生产环境应由 NAS 反向代理根据云端签发的短时签名 URL 提供回看，且只允许 HTTPS。

## 电脑 USB 摄像头

电脑直连 USB 摄像头需要在该电脑运行同一录像服务或本地采集助手，并在 NAS 摄像头配置中填写其受签名保护的局域网命令地址。该助手完成录制后上传媒体到 NAS `data/sessions/`，再向云端回传 NAS 视频索引。

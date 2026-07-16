# 快递拆包与视频取证部署

## 已实现的流程

1. 在 ERP 的“拆包取证”导入退货 Excel。系统会从各店铺工作表提取物流单号、平台、店铺、申请时间、状态和商品信息。
2. 工位扫描物流单号后，ERP 创建“录制中”会话并向 NAS 发送 `start` 命令。
3. NAS 仅在收到开始扫码命令后打开摄像头并保存完整录像，不在空闲时循环录制。开始取证片段保存开始扫码后的前 5 秒。
4. 扫描固定 Code128 条码 `UNPACK_COMPLETE` 后，ERP 将会话标记为完成并向 NAS 发送 `complete` 命令。NAS 继续录制 5 秒，再生成包含完成扫码前后各约 5 秒的完成取证片段和完整录像索引。
5. 云端只保存拆包记录、NAS 相对路径、校验值和状态；MP4 文件只保存在 NAS。

`UNPACK_COMPLETE` 条码可直接从 ERP 工作台显示并打印。它绝不会作为物流单号参与订单匹配。

## 云端 ERP 配置

在阿里云服务器的 `/www/wwwroot/AI-Smart-ERP-Automation-Tool/.env.production` 添加：

```dotenv
UNPACK_NAS_SHARED_SECRET=用 openssl rand -hex 32 生成并粘贴
VIDEO_NAS_COMMAND_URL=https://video.lttlt.top/v1/commands
```

生成密钥：

```bash
openssl rand -hex 32
```

重建 ERP 容器后，先在工作台新增与 NAS 配置同 ID 的摄像头。摄像头名称和 ID 用于视频索引；RTSP 地址只保存在 NAS 的配置文件中，不能填到云端 ERP。

## 飞牛 fnOS NAS 配置

在 NAS 上选择一个大容量共享目录，例如“我的文件/12T备份盘”，复制 `nas-video-service` 文件夹到该目录：

```bash
cd /vol1/unpack-video-service
cp .env.example .env
cp config/cameras.example.json config/cameras.json
```

编辑 `.env`，`UNPACK_NAS_SHARED_SECRET` 必须与云端一致，回调地址填写：

```dotenv
CLOUD_CALLBACK_URL=https://erp.lttlt.top/api/unpack/nas/video-clips
```

编辑 `config/cameras.json`。海康 IPC 使用 ONVIF 获取的 RTSP 地址；NAS USB 摄像头使用 `/dev/video0` 或实际设备路径：

```json
[
  {
    "id": "hikvision-unpack-1",
    "name": "拆包台海康摄像头",
    "type": "hikvision_rtsp",
    "source": "rtsp://username:password@192.168.1.64:554/Streaming/Channels/101",
    "enabled": true
  },
  {
    "id": "nas-usb-1",
    "name": "NAS USB 摄像头",
    "type": "nas_usb",
    "source": "/dev/video0",
    "enabled": true
  }
]
```

启动服务：

```bash
docker compose up -d --build
docker compose logs -f
```

`docker-compose.yml` 当前直通 `/dev/video0`；第二个 NAS USB 摄像头时，增加对应的 `devices` 映射。海康摄像头不需要设备直通。

## video.lttlt.top

用 NAS 的 Nginx 或宝塔反向代理将 `https://video.lttlt.top` 转到 `http://127.0.0.1:4180`，并启用 HTTPS。该入口仅接收云端带 HMAC 签名的录像命令；不要将 `/data/sessions` 配置为静态目录，也不要开放 NAS Docker 端口到公网。

视频播放的下一步是将 NAS 播放接口加上短时签名 URL，再由 ERP 在授权会话中申请播放链接。当前版本先完整实现录像、索引与回调，不会公开任何视频文件。

## 设备范围与运维

- 已实现的 NAS 采集：海康 RTSP/ONVIF 流、NAS 本机 USB `v4l2` 摄像头。
- 电脑 USB 摄像头需要在电脑上将录像目录挂载到 NAS，并运行同一采集服务的工作站实例；部署时为它配置独立端口和摄像头 ID。该实例同样只通过 NAS 存储写入，不上传云端。
- 手机扫码使用 ERP 工作台的“手机扫码”功能，手机需登录同一个受 Basic Auth 保护的 ERP；浏览器支持 `BarcodeDetector` 时可直接识别条码。
- 钉钉管理员/操作员登录需要企业内部应用的 `CorpId`、应用 `AppKey/AppSecret` 和正式回调 URL。当前 ERP 保留操作员字段，外部登录尚未启用，不能假装已有钉钉授权。
- NAS 保留策略建议用 fnOS 计划任务每天清理 `data/sessions` 中早于 90 天的目录。服务空闲时不会写入录像或循环缓存；清理前先确认 ERP 已获得对应视频索引。

## 上线验收

```bash
curl -u '907609732:cyc1314520' https://erp.lttlt.top/api/health
curl -u '907609732:cyc1314520' https://video.lttlt.top/health
```

然后在 ERP 工作台中：导入 Excel、添加摄像头、扫描测试单号、等待至少 5 秒后扫描 `UNPACK_COMPLETE`。确认一条会话拥有 `full`、`start_event`、`completion_event` 三个视频索引，并在 NAS 的 `data/sessions/<会话ID>/` 看到文件。空闲时 `data/ring/` 不应产生新视频文件。

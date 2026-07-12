import crypto from "node:crypto";
import axios from "axios";

function buildWebhookUrl(webhook, secret) {
  if (!secret) return webhook;

  const timestamp = Date.now();
  const signSource = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac("sha256", secret)
    .update(signSource)
    .digest("base64");

  const url = new URL(webhook);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

export async function sendDingTalkMarkdown({ title, text }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.log("未配置 DINGTALK_WEBHOOK，跳过钉钉发送。");
    return { skipped: true };
  }

  const url = buildWebhookUrl(webhook, process.env.DINGTALK_SECRET);
  const response = await axios.post(url, {
    msgtype: "markdown",
    markdown: { title, text }
  });

  if (response.data?.errcode !== 0) {
    throw new Error(`钉钉发送失败：${JSON.stringify(response.data)}`);
  }

  return response.data;
}

export async function sendDingTalkActionCard({ title, text, singleTitle, singleUrl }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.log("未配置 DINGTALK_WEBHOOK，跳过钉钉发送。");
    return { skipped: true };
  }

  const url = buildWebhookUrl(webhook, process.env.DINGTALK_SECRET);
  const response = await axios.post(url, {
    msgtype: "actionCard",
    actionCard: {
      title,
      text,
      single_title: singleTitle || "查看详情",
      single_url: singleUrl || ""
    }
  });

  if (response.data?.errcode !== 0) {
    throw new Error(`钉钉发送失败：${JSON.stringify(response.data)}`);
  }

  return response.data;
}

export async function sendDingTalkFeedCard({ links }) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.log("未配置 DINGTALK_WEBHOOK，跳过钉钉发送。");
    return { skipped: true };
  }

  const url = buildWebhookUrl(webhook, process.env.DINGTALK_SECRET);
  const response = await axios.post(url, {
    msgtype: "feedCard",
    feedCard: { links }
  });

  if (response.data?.errcode !== 0) {
    throw new Error(`钉钉发送失败：${JSON.stringify(response.data)}`);
  }

  return response.data;
}


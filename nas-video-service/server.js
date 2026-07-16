import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4180);
const dataRoot = "/data";
const ringRoot = path.join(dataRoot, "ring");
const sessionsRoot = path.join(dataRoot, "sessions");
const camerasFile = process.env.CAMERAS_FILE || "/config/cameras.json";
const secret = process.env.UNPACK_NAS_SHARED_SECRET || "";
const callbacks = new Map();
const ringProcesses = new Map();
const sessionProcesses = new Map();

for (const dir of [dataRoot, ringRoot, sessionsRoot]) fs.mkdirSync(dir, { recursive: true });
app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString("utf8"); } }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, cameras: cameras().map(({ id, name, type, enabled }) => ({ id, name, type, enabled })), activeSessions: sessionProcesses.size });
});

app.post("/v1/commands", async (req, res) => {
  try {
    verifyRequest(req);
    const command = req.body || {};
    if (!command.sessionId || !["start", "complete"].includes(command.commandType)) throw new Error("无效的录像命令。");
    if (command.commandType === "start") await startSession(command);
    else await completeSession(command);
    res.status(202).json({ ok: true, commandId: command.id, sessionId: command.sessionId });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

function cameras() {
  if (!fs.existsSync(camerasFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(camerasFile, "utf8"));
  return Array.isArray(parsed) ? parsed.filter((camera) => camera.enabled !== false) : [];
}

function verifyRequest(req) {
  if (!secret) throw new Error("UNPACK_NAS_SHARED_SECRET 未配置。");
  const timestamp = req.header("x-unpack-timestamp");
  const signature = req.header("x-unpack-signature") || "";
  if (!timestamp || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) throw new Error("命令时间戳无效。");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${req.rawBody || ""}`).digest("hex");
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error("命令签名无效。");
}

async function startSession(command) {
  if (sessionProcesses.has(command.sessionId)) throw new Error("该拆包会话已在录像中。");
  const session = command.payload?.session || {};
  const sessionDir = path.join(sessionsRoot, safePart(command.sessionId));
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify({ command, receivedAt: new Date().toISOString() }, null, 2));
  const entries = new Map();
  for (const camera of cameras()) {
    startRing(camera);
    const output = path.join(sessionDir, `${safePart(camera.id)}-full.mp4`);
    const process = spawnFfmpeg(camera, output, watermark(camera, session, "录制中"));
    entries.set(camera.id, { camera, process, output, startedAt: new Date() });
  }
  sessionProcesses.set(command.sessionId, { command, session, sessionDir, entries });
  // Acknowledge the scanner command immediately; the after-event window is captured in the background.
  void wait(5000).then(() => Promise.all([...entries.values()].map((entry) =>
    createEventClip(command.sessionId, entry.camera, session.startedAt, "start_event")
  ))).catch(() => null);
}

async function completeSession(command) {
  const state = sessionProcesses.get(command.sessionId);
  if (!state) throw new Error("NAS 中没有该进行中的录像会话。");
  // Keep the final five seconds without holding up the ERP scanner request.
  sessionProcesses.delete(command.sessionId);
  void finishSession(command, state).catch(() => null);
}

async function finishSession(command, state) {
  await wait(5000);
  for (const entry of state.entries.values()) entry.process.kill("SIGINT");
  await Promise.all([...state.entries.values()].map((entry) => createEventClip(command.sessionId, entry.camera, new Date().toISOString(), "completion_event")));
  await Promise.all([...state.entries.values()].map((entry) => notifyCloud({
    sessionId: command.sessionId,
    clipType: "full",
    cameraId: entry.camera.id,
    videoRef: relativeVideoRef(entry.output),
    startedAt: state.session.startedAt || "",
    endedAt: new Date().toISOString(),
    checksum: fileChecksum(entry.output),
    status: fs.existsSync(entry.output) ? "ready" : "failed"
  })));
}

function startRing(camera) {
  if (ringProcesses.has(camera.id)) return;
  const directory = path.join(ringRoot, safePart(camera.id));
  fs.mkdirSync(directory, { recursive: true });
  const args = [
    ...inputArgs(camera),
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-sc_threshold", "0", "-an",
    "-f", "segment", "-segment_time", "5", "-segment_format", "mp4", "-reset_timestamps", "1",
    "-strftime", "1", path.join(directory, "%Y%m%d-%H%M%S.mp4")
  ];
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", ...args], { stdio: "ignore" });
  child.on("exit", () => ringProcesses.delete(camera.id));
  ringProcesses.set(camera.id, child);
}

async function createEventClip(sessionId, camera, timestamp, clipType) {
  const eventTime = new Date(timestamp || Date.now()).getTime();
  const directory = path.join(ringRoot, safePart(camera.id));
  const sourceFiles = fs.existsSync(directory)
    ? fs.readdirSync(directory).map((name) => path.join(directory, name)).filter((file) => {
        const age = fs.statSync(file).mtimeMs - eventTime;
        return age >= -6000 && age <= 6000;
      }).sort()
    : [];
  const output = path.join(sessionsRoot, safePart(sessionId), `${safePart(camera.id)}-${clipType}.mp4`);
  if (sourceFiles.length) {
    const concat = path.join(sessionsRoot, safePart(sessionId), `${safePart(camera.id)}-${clipType}.txt`);
    fs.writeFileSync(concat, sourceFiles.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join("\n"));
    await run("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", "-y", output]);
  }
  await notifyCloud({
    sessionId,
    clipType,
    cameraId: camera.id,
    videoRef: relativeVideoRef(output),
    startedAt: new Date(eventTime - 5000).toISOString(),
    endedAt: new Date(eventTime + 5000).toISOString(),
    checksum: fileChecksum(output),
    status: fs.existsSync(output) ? "ready" : "failed"
  });
}

function spawnFfmpeg(camera, output, text) {
  const args = [...inputArgs(camera), "-vf", `drawtext=fontfile=${process.env.FONT_FILE || ""}:text='${text}':x=24:y=24:fontcolor=white:fontsize=28:box=1:boxcolor=black@0.55`, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", "-y", output];
  return spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", ...args], { stdio: "ignore", env: { ...process.env, TZ: "Asia/Shanghai" } });
}

function inputArgs(camera) {
  if (camera.type === "nas_usb") {
    const input = ["-f", "v4l2"];
    if (camera.inputFormat) input.push("-input_format", String(camera.inputFormat));
    if (camera.videoSize) input.push("-video_size", String(camera.videoSize));
    if (camera.framerate) input.push("-framerate", String(camera.framerate));
    return [...input, "-i", camera.source];
  }
  return ["-rtsp_transport", "tcp", "-i", camera.source];
}

async function notifyCloud(payload) {
  const url = process.env.CLOUD_CALLBACK_URL || "";
  if (!url || !secret) return;
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-unpack-timestamp": timestamp, "x-unpack-signature": signature }, body }).catch(() => null);
}

function watermark(camera, session, state) {
  const label = escapeDrawText(`${session.trackingNo || ""} ${camera.name || camera.id} ${state}`);
  return `${label} %{localtime}`;
}
function escapeDrawText(value) { return String(value || "").replace(/[':]/g, "\\$&"); }
function safePart(value) { return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_"); }
function relativeVideoRef(file) { return path.relative(dataRoot, file).split(path.sep).join("/"); }
function fileChecksum(file) { return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : ""; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function run(command, args) { return new Promise((resolve) => { const child = spawn(command, args, { stdio: "ignore" }); child.on("exit", resolve); }); }

setInterval(() => {
  const cutoff = Date.now() - 15 * 1000;
  for (const camera of cameras()) {
    const directory = path.join(ringRoot, safePart(camera.id));
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  }
}, 5000).unref();

app.listen(port, () => console.log(`NAS unpack video service listening on ${port}`));

// Shared by the demo recordings (scripts/demo*.mjs): a throwaway canvas server, a headless Chrome
// filmed through the DevTools screencast, a simulated hand for the user, the HTTP API for the agent,
// and ffmpeg to turn the frames into docs/<name>.mp4 and docs/<name>.gif.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens `path` (e.g. "/" or "/?overlay") on a fresh canvas server in a W×H headless Chrome.
export async function openDemo({ path: pagePath = '/', port = 4791, cdp = 9225, width = 1440, height = 860 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-demo-'));
  const BASE = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(ROOT, 'src', 'doodle.mjs'), 'serve'], {
    env: { ...process.env, DOODLE_DIR: path.join(tmp, 'doodle'), DOODLE_PORT: String(port) }, stdio: 'ignore',
  });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, `--user-data-dir=${path.join(tmp, 'chrome')}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { server.kill(); chrome.kill(); };
  process.on('exit', cleanup);

  let targets = [];
  for (let i = 0; i < 50 && !targets.length; i++) {
    await sleep(200);
    try { targets = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()).filter((t) => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const waiting = new Map(), frames = [];
  const framesDir = path.join(tmp, 'frames');
  fs.mkdirSync(framesDir);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
    if (m.method === 'Page.screencastFrame') {
      const file = path.join(framesDir, `${String(frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
      frames.push({ file, t: m.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };

  // The tour is for real first runs, not for the video.
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('doodle.tourDone', '1')" });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/state`); break; } catch { await sleep(100); } }
  await send('Page.navigate', { url: BASE + pagePath });
  await sleep(1500);
  await evaluate('tourAt >= 0 && endTour()');

  // ---------------------------------------------------------------- the user's hand

  // Canvas (logical) coordinates to page coordinates.
  const view = await evaluate('({ x: paper.getBoundingClientRect().left, y: paper.getBoundingClientRect().top, k: scale })');
  const page = ([x, y]) => [view.x + x * view.k, view.y + y * view.k];
  const mouse = (type, [x, y], extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });

  async function stroke(points, ms = 600) {
    const pts = points.map(page);
    await mouse('mousePressed', pts[0], { clickCount: 1, buttons: 1 });
    for (const p of pts.slice(1)) { await mouse('mouseMoved', p, { buttons: 1 }); await sleep(ms / pts.length); }
    await mouse('mouseReleased', pts[pts.length - 1], { clickCount: 1 });
    await sleep(120);
  }
  async function click(selector) {
    const [x, y] = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await mouse('mousePressed', [x, y], { clickCount: 1, buttons: 1 });
    await mouse('mouseReleased', [x, y], { clickCount: 1 });
    await sleep(150);
  }
  async function drag(from, to, steps = 20, ms = 30) {
    await mouse('mousePressed', from, { clickCount: 1, buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps], { buttons: 1 });
      await sleep(ms);
    }
    await mouse('mouseReleased', to, { clickCount: 1 });
  }
  async function type(text, ms = 55) {
    for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(ms); }
  }
  const key = async (k, code = k, vk = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };

  // ---------------------------------------------------------------- the agent

  const ops = async (body) => (await fetch(`${BASE}/api/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: 'claude', ...body }) })).json();
  // An agent listening in the background, so a send shows "Looking at your sketch".
  const listen = () => fetch(`${BASE}/api/wait?timeout=60`).then((r) => r.json());
  // A send the agent did not get within a few seconds means a click missed: stop instead of filming it.
  const delivered = (heard, what) => Promise.race([heard, sleep(8000).then(() => { throw new Error(`${what} never reached the agent`); })]);
  const getState = async () => (await fetch(`${BASE}/api/state`)).json();
  const userIds = async () => (await getState()).items.filter((it) => it.author === 'user').map((it) => it.id);

  // ---------------------------------------------------------------- recording

  const record = () => send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });

  // Stop filming, encode docs/<name>.mp4 and .gif, and shut everything down.
  async function finish(name, { holdLast = 3, gifWidth = 960 } = {}) {
    await send('Page.stopScreencast');
    await sleep(300);
    fs.mkdirSync(OUT, { recursive: true });
    const list = frames.map((f, i) => {
      const next = frames[i + 1] ? frames[i + 1].t : f.t + holdLast;  // hold the last scene
      return `file '${f.file}'\nduration ${Math.max(0.01, next - f.t).toFixed(3)}`;
    }).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`;
    const listFile = path.join(tmp, 'frames.txt');
    fs.writeFileSync(listFile, list);
    const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    const mp4 = path.join(OUT, `${name}.mp4`), gif = path.join(OUT, `${name}.gif`);
    ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '22', '-movflags', '+faststart', mp4]);
    ff(['-i', mp4, '-vf', `fps=12,scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
    const kb = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
    console.log(`${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s`);
    console.log(`docs/${name}.mp4 ${kb(mp4)}, docs/${name}.gif ${kb(gif)}`);
    ws.close();
    cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { send, evaluate, page, mouse, stroke, click, drag, type, key, ops, listen, delivered, getState, userIds, record, finish };
}

// A hand-drawn loop around a box, a little wobbly and not quite closed.
export function roughBox(x, y, w, h) {
  const pts = [], n = 28, jitter = () => (Math.random() - 0.5) * 6;
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + 6, y + 4]];
  for (let s = 0; s < corners.length - 1; s++) {
    const [ax, ay] = corners[s], [bx, by] = corners[s + 1];
    for (let i = 0; i < n / 4; i++) { const t = i / (n / 4); pts.push([ax + (bx - ax) * t + jitter(), ay + (by - ay) * t + jitter()]); }
  }
  return pts;
}

// A hand-drawn loop around an area, starting top-left and overlapping a little at the end.
export function roughEllipse(cx, cy, rx, ry, n = 40) {
  return Array.from({ length: n + 4 }, (_, i) => {
    const t = Math.PI * 1.15 + (i / n) * Math.PI * 2;
    const k = 1 + (Math.random() - 0.5) * 0.05;
    return [cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)];
  });
}

export const roughLine = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * (i / n) + (Math.random() - 0.5) * 4, a[1] + (b[1] - a[1]) * (i / n) + Math.sin(i) * 3]);
export const roughArrow = (a, b) => [roughLine(a, b), roughLine([b[0] - 16, b[1] - 12], b, 4), roughLine([b[0] - 16, b[1] + 12], b, 4)];

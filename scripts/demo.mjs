#!/usr/bin/env node
// Records the intro video: a scripted session on a throwaway canvas, filmed in headless Chrome.
// The "user" draws with simulated mouse input; the "agent" answers through the same HTTP API the
// CLI uses. Frames come from the DevTools screencast and ffmpeg turns them into docs/demo.mp4 and
// docs/demo.gif.
//
// usage: node scripts/demo.mjs        (needs Node 22+, Google Chrome and ffmpeg)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const PORT = 4791, CDP = 9225, W = 1440, H = 860;
const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-demo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- canvas server and browser

const server = spawn(process.execPath, [path.join(ROOT, 'src', 'doodle.mjs'), 'serve'], {
  env: { ...process.env, DOODLE_DIR: path.join(tmp, 'doodle'), DOODLE_PORT: String(PORT) }, stdio: 'ignore',
});
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(tmp, 'chrome')}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { server.kill(); chrome.kill(); };
process.on('exit', cleanup);

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  await sleep(200);
  try { targets = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).filter((t) => t.type === 'page'); } catch {}
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
function send(method, params = {}) {
  return new Promise((r) => { const id = ++nextId; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
}
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

// The tour is for real first runs, not for the video.
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('doodle.tourDone', '1')" });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api/state`); break; } catch { await sleep(100); } }
await send('Page.navigate', { url: BASE });
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

// A hand-drawn loop around a box, a little wobbly and not quite closed.
function roughBox(x, y, w, h) {
  const pts = [], n = 28, jitter = () => (Math.random() - 0.5) * 6;
  const path = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + 6, y + 4]];
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, ay] = path[s], [bx, by] = path[s + 1];
    for (let i = 0; i < n / 4; i++) { const t = i / (n / 4); pts.push([ax + (bx - ax) * t + jitter(), ay + (by - ay) * t + jitter()]); }
  }
  return pts;
}
const roughLine = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * (i / n) + (Math.random() - 0.5) * 4, a[1] + (b[1] - a[1]) * (i / n) + Math.sin(i) * 3]);
const roughArrow = (a, b) => [roughLine(a, b), roughLine([b[0] - 16, b[1] - 12], b, 4), roughLine([b[0] - 16, b[1] + 12], b, 4)];

async function click(selector) {
  const [x, y] = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await mouse('mousePressed', [x, y], { clickCount: 1, buttons: 1 });
  await mouse('mouseReleased', [x, y], { clickCount: 1 });
  await sleep(150);
}
async function type(text, ms = 55) {
  for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(ms); }
}

// ---------------------------------------------------------------- the agent

const ops = async (body) => (await fetch(`${BASE}/api/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: 'claude', ...body }) })).json();
// An agent listening in the background, so a send shows "Looking at your sketch".
const listen = () => fetch(`${BASE}/api/wait?timeout=60`).then((r) => r.json());
// A send the agent did not get within a few seconds means a click missed: stop instead of filming it.
const delivered = (heard, what) => Promise.race([heard, sleep(8000).then(() => { throw new Error(`${what} never reached the agent`); })]);
const userIds = async () => (await (await fetch(`${BASE}/api/state`)).json()).items.filter((it) => it.author === 'user').map((it) => it.id);

// ---------------------------------------------------------------- the scene

await send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
await sleep(900);

// 1. A rough pipeline sketch.
for (const x of [110, 420, 730]) { await stroke(roughBox(x, 300, 190, 100), 700); await sleep(150); }
for (const [a, b] of [[[305, 350], [412, 350]], [[615, 350], [722, 350]]]) for (const s of roughArrow(a, b)) await stroke(s, 220);
await sleep(500);

// 2. A note and Send, with the agent listening.
let heard = listen();
await click('#note');
await type('logs → clean → features, then a model?');
await sleep(400);
await click('#send');
await delivered(heard, 'the first send');
await sleep(2600);

// 3. The agent cleans it up and asks about the last step.
await ops({
  remove: await userIds(),
  add: [
    { type: 'rect', x: 110, y: 300, w: 190, h: 100, text: 'raw logs' },
    { type: 'rect', x: 420, y: 300, w: 190, h: 100, text: 'clean' },
    { type: 'rect', x: 730, y: 300, w: 190, h: 100, text: 'features' },
    { type: 'rect', x: 1000, y: 300, w: 150, h: 100, text: '?', dashed: true },
    { type: 'arrow', points: [[0, 0], [1, 1]], from: '#0', to: '#1' },
    { type: 'arrow', points: [[0, 0], [1, 1]], from: '#1', to: '#2' },
    { type: 'arrow', points: [[0, 0], [1, 1]], from: '#2', to: '#3' },
  ],
  say: 'A pipeline from logs to features. What model goes at the end?',
  ask: true,
});
await sleep(2600);

// 4. The user fills in the "?" box and answers Yes.
await click('[data-tool="select"]');
const q = page([1075, 350]);
for (const n of [1, 2]) { await mouse('mousePressed', q, { clickCount: n, buttons: 1 }); await mouse('mouseReleased', q, { clickCount: n }); }
await sleep(300);
await evaluate("textInput.select()");
await type('two-tower');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(700);
heard = listen();
await click('[data-answer="yes"]');
await delivered(heard, 'the Yes answer');
await sleep(2200);

// 5. The agent finishes the model end.
const state = await (await fetch(`${BASE}/api/state`)).json();
const last = state.items.find((it) => it.type === 'rect' && it.dashed);
await ops({
  update: [{ id: last.id, text: 'two-tower model', dashed: false, w: 170 }],
  add: [{ type: 'ellipse', x: 1000, y: 500, w: 170, h: 90, text: 'ranking loss' }, { type: 'arrow', points: [[0, 0], [1, 1]], from: last.id, to: '#0' }],
  say: 'Two-tower model trained with a ranking loss. Ready to build it?',
});
await sleep(2400);

// 6. Moving a box: the arrows follow.
const clean = page([515, 350]);
await mouse('mousePressed', clean, { clickCount: 1, buttons: 1 });
for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', [clean[0], clean[1] + i * 7], { buttons: 1 }); await sleep(30); }
await mouse('mouseReleased', [clean[0], clean[1] + 140], { clickCount: 1 });
await sleep(3200);

await send('Page.stopScreencast');
await sleep(300);

// ---------------------------------------------------------------- encode

fs.mkdirSync(OUT, { recursive: true });
const list = frames.map((f, i) => {
  const next = frames[i + 1] ? frames[i + 1].t : f.t + 3;  // hold the last scene
  return `file '${f.file}'\nduration ${Math.max(0.01, next - f.t).toFixed(3)}`;
}).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`;
const listFile = path.join(tmp, 'frames.txt');
fs.writeFileSync(listFile, list);
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '22', '-movflags', '+faststart', path.join(OUT, 'demo.mp4')]);
ff(['-i', path.join(OUT, 'demo.mp4'), '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', path.join(OUT, 'demo.gif')]);
const kb = (f) => `${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)} KB`;
console.log(`${frames.length} frames, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)} s`);
console.log(`docs/demo.mp4 ${kb('demo.mp4')}, docs/demo.gif ${kb('demo.gif')}`);
ws.close();
cleanup();
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);

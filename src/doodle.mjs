#!/usr/bin/env node
// doodle-prompt: a shared canvas you and Claude sketch on together.
// One file, no dependencies. `serve` runs the canvas server; every other
// subcommand is a thin client the agent calls through Bash.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DOODLE_DIR || path.join(process.cwd(), '.doodle'));
const SERVER_FILE = path.join(DATA_DIR, 'server.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CANVAS_PNG = path.join(DATA_DIR, 'canvas.png');
const SENT_PNG = path.join(DATA_DIR, 'sent.png');
const DEFAULT_PORT = Number(process.env.DOODLE_PORT || 4777);
const CANVAS = { width: 1200, height: 800 };
// How long the window may stay closed before a waiting agent is told; covers a reload or a slow first open.
const CLOSE_GRACE_MS = 8000;
const SHAPE_TYPES = new Set(['stroke', 'line', 'arrow', 'polygon', 'rect', 'ellipse', 'text']);

// ---------------------------------------------------------------- server

function serve() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Keep sketches out of the user's git history without touching their .gitignore.
  fs.writeFileSync(path.join(DATA_DIR, '.gitignore'), '*\n');

  let state = { version: 0, nextId: 1, items: [], say: null, ask: false };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
  const history = [];
  let snapshotVersion = -1;
  const pendingSends = [];
  const waiters = new Set();
  const snapshotWaiters = new Set();
  const clients = new Set();
  let closedAt = null;  // when the last canvas window disconnected; null while one is open or none has been yet

  const publicState = () => ({
    version: state.version, items: state.items, say: state.say, ask: state.ask,
    canvas: CANVAS, waiting: waiters.size > 0, viewers: clients.size,
  });

  function broadcast() {
    const msg = `data: ${JSON.stringify(publicState())}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function commit() {
    state.version += 1;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    broadcast();
  }

  function checkpoint() {
    history.push(JSON.stringify({ items: state.items, say: state.say }));
    if (history.length > 200) history.shift();
  }

  function applyOps(body) {
    const author = body.author === 'claude' ? 'claude' : 'user';
    const ids = [];
    checkpoint();
    if (body.clear) {
      const who = body.clear;
      state.items = who === 'all' ? [] : state.items.filter((it) => it.author !== who);
    }
    if (Array.isArray(body.remove) && body.remove.length) {
      const drop = new Set(body.remove);
      state.items = state.items.filter((it) => !drop.has(it.id));
    }
    for (const shape of body.add || []) {
      if (!shape || !SHAPE_TYPES.has(shape.type)) throw new Error(`unknown shape type: ${shape && shape.type}`);
      const id = `${author === 'claude' ? 'c' : 'u'}${state.nextId++}`;
      state.items.push({ ...shape, id, author });
      ids.push(id);
    }
    if (body.say !== undefined) {
      state.say = body.say ? String(body.say) : null;
      state.ask = Boolean(body.ask && state.say);
    }
    commit();
    return ids;
  }

  function flushSends() {
    if (!pendingSends.length || !waiters.size) return;
    const batch = pendingSends.splice(0);
    const result = {
      note: batch.map((s) => s.note).filter(Boolean).join('\n'),
      png: SENT_PNG, version: state.version, sends: batch.length,
    };
    for (const w of [...waiters]) w(result);
    waiters.clear();
    broadcast();
  }

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });

  const writePng = (file, dataUrl) => {
    const b64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
    if (b64) fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  };

  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(HERE, 'canvas.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState());
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(publicState())}\n\n`);
        clients.add(res);
        closedAt = null;
        broadcast();
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
          if (!clients.size) closedAt = Date.now();
          broadcast();
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ops') {
        const ids = applyOps(await readBody(req));
        return json(res, 200, { version: state.version, ids });
      }
      if (req.method === 'POST' && url.pathname === '/api/opening') {
        if (!clients.size) closedAt = Date.now();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        const prev = history.pop();
        if (prev) { Object.assign(state, JSON.parse(prev)); commit(); }
        return json(res, 200, { version: state.version, undone: Boolean(prev) });
      }
      if (req.method === 'POST' && url.pathname === '/api/snapshot') {
        const body = await readBody(req);
        writePng(CANVAS_PNG, body.png);
        snapshotVersion = Math.max(snapshotVersion, Number(body.version) || 0);
        for (const w of [...snapshotWaiters]) w();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/send') {
        const body = await readBody(req);
        writePng(SENT_PNG, body.png);
        writePng(CANVAS_PNG, body.png);
        pendingSends.push({ note: String(body.note || '').trim(), at: Date.now() });
        if (state.ask) { state.ask = false; commit(); }
        flushSends();
        return json(res, 200, { ok: true, delivered: pendingSends.length === 0 });
      }
      if (req.method === 'GET' && url.pathname === '/api/wait') {
        const raw = Number(url.searchParams.get('timeout'));
        const timeout = Math.min(Number.isFinite(raw) && raw >= 0 ? raw : 25, 60) * 1000;
        if (timeout === 0) {
          if (!pendingSends.length) return json(res, 200, { timeout: true });
          let result;
          waiters.add((r) => { result = r; });
          flushSends();
          return json(res, 200, result);
        }
        let done = false;
        const finish = (result) => { if (!done) { done = true; clearTimeout(t); json(res, 200, result); } };
        const t = setTimeout(() => { waiters.delete(finish); broadcast(); finish({ timeout: true }); }, timeout);
        req.on('close', () => { if (!done) { done = true; clearTimeout(t); waiters.delete(finish); broadcast(); } });
        waiters.add(finish);
        broadcast();
        flushSends();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot-wait') {
        const want = Number(url.searchParams.get('version')) || state.version;
        const timeout = Math.min(Number(url.searchParams.get('timeout')) || 5, 30) * 1000;
        if (snapshotVersion >= want) return json(res, 200, { ok: true, png: CANVAS_PNG });
        const done = () => { if (snapshotVersion >= want) { clearTimeout(t); snapshotWaiters.delete(done); json(res, 200, { ok: true, png: CANVAS_PNG }); } };
        const t = setTimeout(() => { snapshotWaiters.delete(done); json(res, 200, { ok: false, png: CANVAS_PNG }); }, timeout);
        snapshotWaiters.add(done);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        json(res, 200, { ok: true });
        try { fs.unlinkSync(SERVER_FILE); } catch {}
        setTimeout(() => process.exit(0), 50);
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  });

  // A waiting agent should not keep listening to a canvas nobody has open.
  setInterval(() => {
    if (!waiters.size || closedAt === null || Date.now() - closedAt < CLOSE_GRACE_MS) return;
    for (const w of [...waiters]) w({ closed: true });
    waiters.clear();
    broadcast();
  }, 1000).unref();

  const listen = (port) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0) return listen(0);
      throw e;
    });
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      fs.writeFileSync(SERVER_FILE, JSON.stringify({ port: actual, pid: process.pid, url: `http://127.0.0.1:${actual}/` }));
    });
  };
  listen(DEFAULT_PORT);
}

// ---------------------------------------------------------------- client

function readServerInfo() {
  try { return JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8')); } catch { return null; }
}

async function api(method, route, body) {
  const info = readServerInfo();
  if (!info) throw new Error('canvas is not running; run `doodle.mjs start` first');
  const res = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function alive() {
  try { await api('GET', '/api/state'); return true; } catch { return false; }
}

function which(cmd) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return true; } catch { return false; }
  });
}

// Open the canvas as a chromeless app window (Chrome/Edge `--app`) so it can sit beside the
// terminal like a native window. Falls back to a normal browser tab.
function openWindow(url, { tab = false } = {}) {
  const appArgs = [`--app=${url}`, '--window-size=960,720'];
  const isWsl = process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  const run = (cmd, args, fallback) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => fallback && fallback());
    child.unref();
  };
  const plainTab = () => {
    const [cmd, args] =
      process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' || isWsl ? [isWsl ? 'cmd.exe' : 'cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
    execFile(cmd, args, () => {});
  };
  if (tab) return plainTab();

  if (process.env.DOODLE_BROWSER) return run(process.env.DOODLE_BROWSER, appArgs, plainTab);
  if (process.platform === 'win32' || isWsl) {
    // `start` resolves msedge/chrome through Windows' App Paths, so no install path is needed.
    const browser = process.env.DOODLE_WINDOWS_BROWSER || 'msedge';
    return execFile(isWsl ? 'cmd.exe' : 'cmd', ['/c', 'start', '', browser, ...appArgs], (err) => err && plainTab());
  }
  if (process.platform === 'darwin') {
    const app = ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser', 'Arc']
      .find((name) => fs.existsSync(`/Applications/${name}.app`));
    return app ? run('open', ['-na', app, '--args', ...appArgs], plainTab) : plainTab();
  }
  const bin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
    .find(which);
  return bin ? run(bin, appArgs, plainTab) : plainTab();
}

async function start(flags) {
  if (!(await alive())) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try { fs.unlinkSync(SERVER_FILE); } catch {}
    const log = fs.openSync(path.join(DATA_DIR, 'server.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      detached: true, stdio: ['ignore', log, log], env: { ...process.env, DOODLE_DIR: DATA_DIR },
    });
    child.unref();
    for (let i = 0; i < 50 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await alive())) throw new Error(`server failed to start; see ${path.join(DATA_DIR, 'server.log')}`);
  }
  const { url } = readServerInfo();
  const { viewers } = await api('GET', '/api/state');
  if (!flags['no-open']) {
    if (viewers > 0 && !flags.force) console.log('Canvas window is already open.');
    else { await api('POST', '/api/opening'); openWindow(url, { tab: Boolean(flags.tab) }); }
  }
  console.log(`Canvas: ${url}`);
  console.log(`Data:   ${DATA_DIR}`);
}

function bbox(it) {
  if (it.points) {
    const xs = it.points.map((p) => p[0]); const ys = it.points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
  }
  if (it.type === 'text') {
    const size = it.size || 24;
    const w = String(it.text || '').length * size * 0.55;
    return [it.x, it.y - size, it.x + w, it.y].map(Math.round);
  }
  return [it.x, it.y, it.x + (it.w || 0), it.y + (it.h || 0)].map(Math.round);
}

function describe(state) {
  const lines = [`canvas ${CANVAS.width}x${CANVAS.height}, version ${state.version}, ${state.items.length} items`];
  for (const it of state.items) {
    const [x1, y1, x2, y2] = bbox(it);
    const extra = it.text ? ` "${it.text}"` : it.type === 'stroke' ? ` (${it.points.length} pts)` : '';
    lines.push(`  ${it.id} ${it.author} ${it.type} [${x1},${y1} → ${x2},${y2}]${extra}`);
  }
  if (state.say) lines.push(`bubble: "${state.say}"`);
  return lines.join('\n');
}

async function report(r) {
  const state = await api('GET', '/api/state');
  console.log(`The user sent the canvas${r.sends > 1 ? ` (${r.sends} sends)` : ''}.`);
  console.log(`note: ${r.note || '(none)'}`);
  console.log(`image: ${r.png}`);
  console.log(describe(state));
}

// Blocks until the user presses Send. No timeout unless asked for: it is meant to run in the
// background and wake the agent when it exits.
async function wait(flags) {
  const deadline = flags.timeout ? Date.now() + Number(flags.timeout) * 1000 : Infinity;
  while (Date.now() < deadline) {
    const chunk = Math.max(1, Math.min(25, Math.ceil((deadline - Date.now()) / 1000)));
    const r = await api('GET', `/api/wait?timeout=${chunk}`);
    if (r.closed) return console.log('The canvas window was closed.');
    if (!r.timeout) return report(r);
  }
  console.log('No send before timeout. Run `wait` again to keep listening.');
}

// Non-blocking: picks up sends that arrived while nobody was listening.
async function check() {
  if (!(await alive())) return console.log('Canvas is not running.');
  const r = await api('GET', '/api/wait?timeout=0');
  if (r.timeout) return console.log('Nothing new from the canvas.');
  return report(r);
}

async function readJsonInput(arg) {
  let text = arg;
  if (!text || text === '-') {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    text = Buffer.concat(chunks).toString('utf8');
  } else if (fs.existsSync(text)) {
    text = fs.readFileSync(text, 'utf8');
  }
  return JSON.parse(text);
}

async function draw(arg) {
  const input = await readJsonInput(arg);
  const body = Array.isArray(input) ? { add: input } : input;
  const r = await api('POST', '/api/ops', { ...body, author: 'claude' });
  const snap = await api('GET', `/api/snapshot-wait?version=${r.version}&timeout=5`);
  console.log(`added: ${r.ids.join(', ') || '(none)'}  version ${r.version}`);
  console.log(snap.ok ? `rendered: ${snap.png}` : 'rendered: (no browser tab open; snapshot not refreshed)');
}

function parseFlags(argv) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

const USAGE = `usage: doodle-prompt <command>
  start [--tab|--no-open|--force]
                         start the canvas server and open it as an app window
  wait [--timeout s]     block until the user presses "Send to Claude"
  check                  print a send that arrived while nobody was waiting, if any
  state                  list every item on the canvas with its id and bounds
  draw <json|file|->     add/remove shapes as Claude, e.g. '{"add":[...],"remove":["u3"],"say":"..."}'
  undo                   undo the last change (anyone's)
  clear [claude|user|all]
  stop                   shut the server down`;

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseFlags(argv);
  switch (cmd) {
    case 'serve': return serve();
    case 'start': return start(flags);
    case 'wait': return wait(flags);
    case 'check': return check();
    case 'state': return console.log(describe(await api('GET', '/api/state')));
    case 'draw': return draw(rest[0]);
    case 'undo': return console.log(JSON.stringify(await api('POST', '/api/undo')));
    case 'clear': {
      const r = await api('POST', '/api/ops', { author: 'claude', clear: rest[0] || 'claude' });
      return console.log(`cleared ${rest[0] || 'claude'}; version ${r.version}`);
    }
    case 'stop': {
      if (await alive()) await api('POST', '/api/shutdown');
      return console.log('stopped');
    }
    default: console.log(USAGE); process.exitCode = cmd && !['help', '--help', '-h'].includes(cmd) ? 1 : 0;
  }
}

main().catch((e) => { console.error(`doodle: ${e.message}`); process.exit(1); });

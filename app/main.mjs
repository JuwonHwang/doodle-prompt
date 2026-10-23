// doodle-prompt desktop app (macOS, Windows). Shows the canvas that `doodle.mjs serve` hosts, either
// as a normal window or as a transparent overlay over one whole screen. `doodle.mjs start` launches
// it with --doodle-url (and --doodle-mode=window|overlay); a second launch reuses this instance.

import { app, BrowserWindow, ipcMain, screen, desktopCapturer, systemPreferences, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(HERE, '..', 'src', 'icon-512.png');
const PRELOAD = path.join(HERE, 'preload.cjs');
const LAST_FILE = () => path.join(app.getPath('userData'), 'last.json');
const SCREEN_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

let win = null;
let current = { url: null, mode: 'window' };

// Overlay state, driven by the page: draw mode takes every click; in click-through only the
// page's own UI (toolbar, chat, the floating icon) keeps the mouse.
let drawMode = true;
let follow = false;
let uiRects = [];
let ignoring = false;

function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return { url: get('doodle-url'), mode: get('doodle-mode'), log: get('doodle-log') };
}

// What the app did, appended to .doodle/app.log (the CLI passes --doodle-log) so a session can be
// checked afterwards: mode changes, click-through switches, screen moves, captures.
let logFile = null;
function log(...parts) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${parts.join(' ')}\n`); } catch {}
}

const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function guardNavigation(w, url) {
  const origin = new URL(url).origin;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, to) => { if (new URL(to).origin !== origin) e.preventDefault(); });
}

function canvasWindow(url) {
  const w = new BrowserWindow({
    width: 960, height: 720, minWidth: 480, minHeight: 360, title: 'doodle-prompt', icon: ICON,
    backgroundColor: '#fff6df', autoHideMenuBar: true, show: false,
    webPreferences: { preload: PRELOAD },
  });
  guardNavigation(w, url);
  w.loadURL(url);
  return w;
}

function overlayWindow(url) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = new BrowserWindow({
    ...display.bounds, title: 'doodle-prompt', icon: ICON, show: false,
    frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, enableLargerThanScreen: true, roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setBounds(display.bounds);  // macOS keeps new windows below the menu bar; cover it too
  guardNavigation(w, url);
  w.loadURL(`${url}?overlay`);
  drawMode = true; follow = false; uiRects = []; ignoring = false;
  const timer = setInterval(() => updateMouse(w), 33);
  w.on('closed', () => clearInterval(timer));
  // Ask for Screen Recording up front (macOS shows its prompt the first time a capture is tried).
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
  }
  return w;
}

function updateMouse(w) {
  if (w.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  // The overlay covers one screen; while the floating icon is dragged it moves to the mouse's screen.
  if (follow) {
    const d = screen.getDisplayNearestPoint(p);
    if (!sameRect(d.bounds, w.getBounds())) {
      w.setBounds(d.bounds);
      log('overlay moved to display', d.id, JSON.stringify(d.bounds));
    }
  }
  let ignore = false;
  if (!drawMode) {
    const b = w.getBounds(), x = p.x - b.x, y = p.y - b.y;
    ignore = !uiRects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
  }
  if (ignore !== ignoring) {
    ignoring = ignore;
    w.setIgnoreMouseEvents(ignore, { forward: true });
    log(ignore ? 'mouse passes through' : 'mouse taken', `at ${p.x},${p.y}`);
  }
}

// Show `url` in `mode`. Without a mode, keep the one already showing that canvas, else a window.
function show(url, mode) {
  mode = mode === 'overlay' || mode === 'window' ? mode : (url === current.url ? current.mode : 'window');
  if (win && !win.isDestroyed() && url === current.url && mode === current.mode) {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    return;
  }
  const old = win;
  current = { url, mode };
  log('show', mode, url);
  try { fs.writeFileSync(LAST_FILE(), JSON.stringify({ url, mode, log: logFile })); } catch {}
  win = mode === 'overlay' ? overlayWindow(url) : canvasWindow(url);
  win.once('ready-to-show', () => {
    win.show(); win.focus();
    if (old && !old.isDestroyed()) old.destroy();
  });
}

// Opened without arguments (from the Dock or Start menu, or relaunched by macOS after a permission
// change): reconnect to the last canvas, in the last mode, if its server is still up.
async function showLast() {
  let last = {};
  try { last = JSON.parse(fs.readFileSync(LAST_FILE(), 'utf8')); } catch {}
  if (last.url) {
    if (last.log && !logFile) logFile = last.log;
    try { await fetch(new URL('/api/state', last.url)); return show(last.url, last.mode); } catch {}
  }
  const w = new BrowserWindow({ width: 460, height: 260, title: 'doodle-prompt', icon: ICON, autoHideMenuBar: true, resizable: false });
  w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
    <body style="font:15px/1.5 system-ui,sans-serif;margin:32px;color:#141414;background:#fff6df">
    <h3 style="margin:0 0 8px">No canvas is running</h3>
    <p>Start one from your coding agent, for example <code>/doodle</code> in Claude Code, or run
    <code>npx doodle-prompt start</code> in your project.</p></body>`)}`);
  win = w;
}

// Screenshot of the screen the window is on, without the window itself. `jpeg` keeps captures that
// are stored on the canvas small; the overlay's background for a send stays PNG.
async function capture({ jpeg = false } = {}) {
  if (!win || win.isDestroyed()) return { src: null, permitted: true };
  const denied = () => process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied';
  if (denied()) {
    log('capture skipped: Screen Recording denied; opened settings');
    shell.openExternal(SCREEN_PANE);
    return { src: null, permitted: false };
  }
  const started = Date.now();
  const display = screen.getDisplayMatching(win.getBounds());
  const { width, height } = display.bounds;
  // Hide the window for the moment of the capture so the screenshot shows only what is under it.
  win.setOpacity(0);
  await new Promise((r) => setTimeout(r, 80));
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      log('capture empty', `sources=${sources.length}`);
      return { src: null, permitted: !denied() };
    }
    const size = source.thumbnail.getSize();
    log('capture ok', `${size.width}x${size.height}`, `display=${source.display_id}`, `${Date.now() - started}ms`);
    const src = jpeg ? `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}` : source.thumbnail.toDataURL();
    return { src, permitted: true };
  } catch (err) {
    log('capture failed', err.message);
    if (denied()) shell.openExternal(SCREEN_PANE);
    return { src: null, permitted: !denied() };
  } finally {
    if (!win.isDestroyed()) win.setOpacity(1);
  }
}

ipcMain.on('doodle', (e, msg) => {
  if (!msg || !win || e.sender !== win.webContents) return;
  switch (msg.type) {
    case 'mode':
      drawMode = msg.draw !== false;
      log(drawMode ? 'draw mode' : 'click-through mode');
      if (drawMode) win.focus();
      updateMouse(win);
      break;
    case 'rects':
      uiRects = Array.isArray(msg.rects) ? msg.rects.filter((r) => Array.isArray(r) && r.length === 4) : [];
      updateMouse(win);
      break;
    case 'follow':
      follow = Boolean(msg.on);
      log(follow ? 'icon drag started' : 'icon drag ended');
      break;
    case 'switch':
      if (current.url) show(current.url, msg.to === 'overlay' ? 'overlay' : 'window');
      break;
    case 'close':
      win.close();
      break;
  }
});
ipcMain.handle('doodle-capture', (e, opts) => (win && e.sender === win.webContents ? capture(opts || {}) : { src: null, permitted: true }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const { url, mode, log: file } = parseArgs(argv);
    if (file) logFile = file;
    if (url) show(url, mode);
    else if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(ICON);
    const { url, mode, log: file } = parseArgs(process.argv);
    if (file) logFile = file;
    if (url) show(url, mode); else showLast();
  });
  app.on('window-all-closed', () => app.quit());
}

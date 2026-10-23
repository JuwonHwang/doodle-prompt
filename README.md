# doodle-prompt

English | [한국어](README.ko.md)

**Doodle your ideas. Don't type them.**

A Claude Code plugin and desktop app (macOS, Windows) that opens a shared canvas in its own window, or as a transparent overlay over your whole screen. You scribble, Claude scribbles back, and the sketch gets a little clearer every round. No long prompts. Just draw the box, the arrow, the thing you mean.

```
you:     ▭ ──→           (a rough box and an arrow)
claude:  [Login] ─success→ [Dashboard]   [ ? ]
         "What else lives on the dashboard?"
you:     (circle the ?, scribble a chart)
...
```

## How it works

1. Say `/doodle` (or "let me draw it") in Claude Code. The canvas opens in its own window. Put it next to your terminal.
2. Draw. Pen, shapes, text, and a select tool to move things around. Pick a line width and color, split the sketch into layers you can reorder, hide, rename or delete, and paste in screenshots or text.
3. Press **Send to Claude**. Add a few words if you like, but you don't have to.
4. Claude reads the sketch in the context of your conversation and your repo, then draws on the same canvas: it cleans up rough shapes, adds the missing piece, or asks a question with a dashed `?` box.
5. Keep going. When the idea is clear, ask Claude to build it.

The agent's marks are violet, yours stay in your ink, so you always know who drew what. Undo works on anyone's changes.

## Install

### Claude Code

```
/plugin marketplace add JuwonHwang/doodle-prompt
/plugin install doodle-prompt@doodle-prompt
```

The canvas is shown by the doodle-prompt desktop app. Install it from the [latest release](https://github.com/JuwonHwang/doodle-prompt/releases/latest): the `.dmg` on macOS, the `Setup .exe` on Windows. The builds are not code-signed, so macOS asks you to confirm the first launch (right-click the app → Open) and Windows SmartScreen asks you to choose "Run anyway". The plugin itself needs Node.js 18+.

To run the app from a checkout instead: `npm install`, then the plugin's `start` uses the local Electron automatically. `npm run dist` builds the installers into `dist/`.

### Other agents

The canvas is a plain CLI, so any agent that can run shell commands can use it:

```
npx doodle-prompt start   # open the canvas
npx doodle-prompt wait    # block until the user presses Send
npx doodle-prompt draw -  # draw shapes from JSON on stdin
```

`npx doodle-prompt help` lists every command, and [`skills/doodle/SKILL.md`](skills/doodle/SKILL.md) describes the loop and the shape format. Only Claude Code is tested today. Issues are welcome, including requests for other agents; pull requests are not accepted. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Details

- The canvas server runs locally on `127.0.0.1` (port 4777, or a free one if taken). Nothing leaves your machine except what Claude normally sees.
- Sketches are stored in `.doodle/` in your project. It git-ignores itself.
- The app shows the canvas as a window, or with `start --overlay` (or the screen button in the toolbar) as a transparent sheet over the whole screen, so you draw on top of whatever is open. `DOODLE_APP` points `start` at another build of the app.
- In the overlay, press `Esc` or the click-through button to use the apps underneath while your marks stay visible; press it again to draw. The fold button hides everything behind a floating icon you can drag anywhere; click the icon to bring the overlay back. With several monitors, fold the overlay and drag the icon to another screen; the overlay moves with it. The window button switches back to the normal canvas window. Send includes a screenshot of the screen under your marks; on macOS this needs the Screen Recording permission, which the app asks for the first time you open the overlay.
- Claude listens with a background command, so you can keep chatting while you draw. The status dot in the toolbar shows whether Claude is listening; sends made while it isn't are queued and picked up next time.

Keyboard: `V` select, `P` pen, `E` eraser, `T` text, `R` rectangle, `O` ellipse, `A` arrow, `F` fill, `L` layers, `C` chat panel, `Ctrl/⌘ +`/`-`/`0` zoom in, out, fit, `Space`+drag pan, `Delete` remove selection, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo, `Ctrl/⌘+C`/`X`/`V` copy, cut, paste, `Ctrl/⌘+Enter` send, `Esc` click through (overlay).

## Layout

```
src/doodle.mjs                    canvas server + CLI, launches the app (start, wait, check, draw, state, undo, redo, clear, stop)
src/canvas.html                   the canvas
app/main.mjs                      desktop app (Electron): the canvas window and the overlay
app/preload.cjs                   what the canvas page may ask of the app
.github/workflows/release.yml     builds the macOS and Windows app for a v* tag
src/icon*.svg, icon-*.png         app icon (tab, window, taskbar)
package.json                      npm package (bin: doodle-prompt) and app build config
.claude-plugin/plugin.json        Claude Code plugin manifest
.claude-plugin/marketplace.json   lets this repo be added as a marketplace
skills/doodle/SKILL.md            how Claude runs the sketch loop
```

## Contributing

Issues are welcome; pull requests are not accepted. Forks are free. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

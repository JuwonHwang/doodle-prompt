# doodle-prompt

English | [한국어](README.ko.md)

**Doodle your ideas. Don't type them.**

A Claude Code plugin that opens a shared canvas in its own window. You scribble, Claude scribbles back, and the sketch gets a little clearer every round. No long prompts. Just draw the box, the arrow, the thing you mean.

```
you:     ▭ ──→           (a rough box and an arrow)
claude:  [Login] ─success→ [Dashboard]   [ ? ]
         "What else lives on the dashboard?"
you:     (circle the ?, scribble a chart)
...
```

## How it works

1. Say `/doodle` (or "let me draw it") in Claude Code. The canvas opens in its own window. Put it next to your terminal.
2. Draw. Pen, eraser, text. That's all you need.
3. Press **Send to Claude**. Add a few words if you like, but you don't have to.
4. Claude reads the sketch in the context of your conversation and your repo, then draws on the same canvas: it cleans up rough shapes, adds the missing piece, or asks a question with a dashed `?` box.
5. Keep going. When the idea is clear, ask Claude to build it.

Claude's marks are orange, yours stay in your ink, so you always know who drew what. Undo works on anyone's changes.

## Install

### Claude Code

```
/plugin marketplace add JuwonHwang/doodle-prompt
/plugin install doodle-prompt@doodle-prompt
```

The plugin carries everything it needs. Requires Node.js 18+, no other dependencies.

### Other agents

The canvas is a plain CLI, so any agent that can run shell commands can use it:

```
npx doodle-prompt start   # open the canvas
npx doodle-prompt wait    # block until the user presses Send
npx doodle-prompt draw -  # draw shapes from JSON on stdin
```

`npx doodle-prompt help` lists every command, and [`skills/doodle/SKILL.md`](skills/doodle/SKILL.md) describes the loop and the shape format. Only Claude Code is tested today; contributions for other agents are welcome.

## Details

- The canvas server runs locally on `127.0.0.1` (port 4777, or a free one if taken). Nothing leaves your machine except what Claude normally sees.
- Sketches are stored in `.doodle/` in your project. It git-ignores itself.
- The canvas opens as a chromeless Chrome/Edge app window when one is installed (set `DOODLE_BROWSER` to pick another), else as a normal tab. `start --tab` forces a tab.
- Claude listens with a background command, so you can keep chatting while you draw. The status dot in the toolbar shows whether Claude is listening; sends made while it isn't are queued and picked up next time.

Keyboard: `P` pen, `E` eraser, `T` text, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Enter` send.

## Layout

```
src/doodle.mjs                    canvas server + CLI (start, wait, check, draw, state, undo, clear, stop)
src/canvas.html                   the canvas
package.json                      npm package (bin: doodle-prompt)
.claude-plugin/plugin.json        Claude Code plugin manifest
.claude-plugin/marketplace.json   lets this repo be added as a marketplace
skills/doodle/SKILL.md            how Claude runs the sketch loop
```

## License

MIT

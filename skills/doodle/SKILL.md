---
name: doodle
description: Open a shared sketch canvas in the browser so the user can draw instead of typing, and sketch back on it. Use when the user wants to doodle, sketch, draw, wireframe, or "show" an idea, says /doodle, or says something is easier to draw than to explain. Keep refining the sketch together turn by turn.
---

# doodle

The user would rather draw than type. You share one canvas with them: they scribble, press **Send to Claude**, and you read the sketch, answer, and draw back on the same canvas. Each turn moves the sketch from rough toward clear. You are not trying to finish the work in one go.

Everything runs through one script that ships with this plugin:

```
node "${CLAUDE_PLUGIN_ROOT}/src/doodle.mjs" <command>
```

Below, `doodle` stands for that command.

Data lives in `.doodle/` under the current working directory (it ignores itself in git). Canvas coordinates are logical pixels, 1200 × 800, origin top-left.

## The loop

1. **Start**: `doodle start`. It opens the canvas as its own app window (or reuses the one already open) and prints the URL. Tell the user the URL in one line and say you're listening.
2. **Listen**: run `doodle wait` with Bash `run_in_background: true`. You're re-invoked when the user presses Send, and the conversation stays free while they draw. Never poll, and keep exactly one `wait` running: start a new one only after the previous one has exited.
3. **Read**: the wait output gives the user's note, the image path, and every item with its id and bounds. Open the image with Read. Use both the picture (what it looks like) and the item list (exact positions, ids).
4. **Interpret in context**: decide what the sketch means given the conversation and repo: a UI layout, a flow, a data model, an architecture, a game level, an annotation of something. If it's ambiguous, make your best reading and say it in one line. Don't stack up questions; ask by drawing (see below).
5. **Answer on the canvas**, then in chat in a sentence or two. Pick what moves the sketch forward:
   - **Clean up**: redraw rough strokes as clear shapes with labels, then remove the user's strokes you replaced. Only replace what you're confident about.
   - **Extend**: add the missing piece, a next step, an alternative next to theirs.
   - **Ask by drawing**: a dashed box with `?`, an arrow with a question, two small options side by side.
   - **Comment**: `say` puts a short speech bubble at the top of the canvas. Keep it under ~15 words.
6. **Check your work**: `draw` prints the refreshed `canvas.png`. Read it when the layout is non-trivial, and fix overlaps.
7. **Listen again**: start another background `wait`. Repeat until the user stops sending or asks you to build the thing.

**While a canvas session is going, when the user types in chat instead**, run `doodle check` first. It returns any send that arrived while no `wait` was listening (for example after a restart). If the user says "look", "check the canvas" or similar (in any language) and `check` has nothing, read `.doodle/canvas.png`: it always holds the current canvas.

When the sketch is clear enough to act on, turn it into whatever the context needs (code, a component, a Mermaid diagram, a spec) as a normal response, and keep the canvas around for the next round. Don't start building the real thing without the user asking or clearly signalling it.

## Drawing

`draw` takes JSON as an argument, a file path, or `-` for stdin. Pass a heredoc for anything longer than a line:

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/doodle.mjs" draw - <<'EOF'
{
  "remove": ["u3", "u4"],
  "add": [
    {"type": "rect", "x": 80, "y": 60, "w": 1040, "h": 70, "text": "Header · logo · nav"},
    {"type": "rect", "x": 80, "y": 160, "w": 240, "h": 560, "text": "Sidebar"},
    {"type": "arrow", "points": [[700, 300], [900, 300]], "text": "on click"},
    {"type": "rect", "x": 400, "y": 400, "w": 200, "h": 80, "text": "?", "dashed": true}
  ],
  "say": "Cleaned up the layout. What goes in the dashed box?"
}
EOF
```

Shapes (all coordinates in the 1200 × 800 space):

| type | fields |
|---|---|
| `rect`, `ellipse` | `x`, `y`, `w`, `h`, optional `text` (centered, wraps) |
| `line`, `arrow` | `points: [[x,y], ...]` (two or more), optional `text` (label at the middle) |
| `text` | `x`, `y` (baseline), `text`, optional `size` (default 24) |
| `polygon` | `points` (closed automatically), optional `fill`, `text`: roofs, arrows-as-shapes, any filled outline |
| `stroke` | `points` freehand, for when you want a loose doodle |

Optional on any shape: `color` (default Claude orange, so the user can tell your marks from theirs), `width`, `dashed`, `fill` (e.g. `"rgba(201,100,66,.08)"`), `size` for label text.

Top-level keys: `add`, `remove` (ids from `state`/`wait` output), `clear` (`"claude"`, `"user"`, or `"all"`), `say` (string, or `null` to hide the bubble).

Other commands:

- `state` lists the items without waiting.
- `check` returns a send that arrived while nobody was waiting, without blocking.
- `undo` reverts the last change by anyone.
- `clear claude` removes only your marks.
- `stop` shuts the server down when the user is done.

## Style

- Match the doodle's level of detail. One clear step per turn beats a finished diagram nobody asked for.
- Leave the user's intent intact. When you replace their strokes, keep the same position and proportions so the canvas still feels like theirs.
- Write labels and `say` bubbles in the language the user writes or draws in, not the language of these examples.
- Keep labels short (one to four words). Put explanations in chat or the bubble, not on the canvas.
- Leave room: don't fill the whole canvas. The user should have space to keep drawing.
- If a send arrives with a note, the note wins over your reading of the picture.
- When an instruction the user drew (a check mark, a word like "blue") has been carried out, remove those strokes and every option box you offered, so stale marks don't pile up.

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

Data lives in `.doodle/` under the current working directory (it ignores itself in git). Canvas coordinates are logical pixels, origin top-left. The page is 1200 × 800 unless the user resized it; `wait` and `state` print the current size (`canvas WxH`). Top-level `resize` (`{"width": W, "height": H}`) changes it, but leave the size to the user unless they ask.

## The loop

1. **Start**: `doodle start`. It shows the canvas in the doodle-prompt desktop app (bringing an open one forward) and prints the URL. If it says the app is not installed, tell the user the download link it prints and stop. Tell the user the URL in one line and say you're listening.
   - `doodle start --overlay` shows it instead as a transparent sheet over the whole screen, for when the user wants to draw on top of what is open (an app, a page, a design). Use it when they ask for an overlay, full screen, or to mark up their screen. The page then matches the screen size, and sends from it print a `screen:` line: the image shows the user's screen under the strokes, but the screen is not an item. Place your marks relative to what you see there. `doodle start --window` goes back to the window; the user can also switch with a toolbar button.
2. **Listen**: run `doodle wait` with Bash `run_in_background: true`. You're re-invoked when the user presses Send, and the conversation stays free while they draw. Never poll, and keep exactly one `wait` running: start a new one only after the previous one has exited.
3. **Read**: the wait output gives the user's note, the image path, and every item with its id and bounds. Open the image with Read. Use both the picture (what it looks like) and the item list (exact positions, ids).
4. **Interpret in context**: decide what the sketch means given the conversation and repo: a UI layout, a flow, a data model, an architecture, a game level, an annotation of something. Don't stack up questions; ask by drawing (see below).
5. **Confirm your reading**: say back what you understood, in one short sentence ending in a question, as a `say` message with `"ask": true` (for example "A login screen that leads to a dashboard, right?"). That puts **Yes** / **Not quite** buttons under it in the chat panel, so the user can answer with one click. Repeat the same sentence in chat. Do this on the first send of a session, whenever the sketch is ambiguous, and before you replace the user's strokes or build anything outside the canvas. Skip it for small follow-ups whose meaning is obvious, such as a check mark on an option you offered.
   - When you're unsure, don't remove the user's strokes yet: draw your reading next to them and remove theirs after a **Yes**.
   - A send whose note starts with `yes` or `no` is an answer from those buttons; anything after the dash is what the user typed with it. On `no`, look again, offer a different reading or a choice between two, and ask again.
6. **Answer on the canvas**, then in chat in a sentence or two. Pick what moves the sketch forward:
   - **Clean up**: redraw rough strokes as clear shapes with labels, then remove the user's strokes you replaced. Only replace what you're confident about.
   - **Extend**: add the missing piece, a next step, an alternative next to theirs.
   - **Ask by drawing**: a dashed box with `?`, an arrow with a question, two small options side by side.
   - **Comment**: `say` posts a short message in the chat panel beside the canvas, where the user's notes and sent sketches also appear. Keep it under ~20 words.
7. **Check your work**: `draw` prints the refreshed `canvas.png`. Read it when the layout is non-trivial, and fix overlaps.
8. **Listen again**: start another background `wait`. Repeat until the user stops sending or asks you to build the thing.

Keep a `wait` running even while you work on something the sketch asked for (editing code, running checks): start it right after you answer on the canvas, before the longer work, so the user can keep drawing and sending. A send that arrives mid-task wakes you; finish or pause the current step, then read it.

**When `wait` prints "The canvas window was closed."**, the user is done drawing for now. Don't start another `wait`. Run `doodle stop`, and tell the user in one line that the canvas is closed and they can ask to draw again any time. The sketch is kept in `.doodle/`, so a later `doodle start` reopens it as it was.

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

Shapes (all coordinates in canvas space):

| type | fields |
|---|---|
| `rect`, `ellipse` | `x`, `y`, `w`, `h`, optional `text` (centered, wraps) |
| `line`, `arrow` | `points: [[x,y], ...]` (two or more), optional `text` (label at the middle), optional `from`/`to`: the id of a `rect`, `ellipse`, `text`, `image` or `polygon` (or `"#n"` for the n-th shape added in the same `draw`). A connected end sits on that shape's edge and follows it when the shape moves; `points` then only matter for ends that aren't connected. Connect arrows in flows, pipelines and architectures so the user can rearrange the boxes. `state` shows links as `(c1 → c2)`. |
| `text` | `x`, `y` (baseline), `text`, optional `size` (default 24) |
| `polygon` | `points` (closed automatically), optional `fill`, `text`: roofs, arrows-as-shapes, any filled outline |
| `stroke` | `points` freehand, for when you want a loose doodle |

Optional on any shape: `layer` (a layer id like `L2` or a name; an unknown name creates that layer on top; default is the top layer), `color` (default agent violet `#6c4cf5`, so the user can tell your marks from theirs), `width`, `dashed`, `fill` (e.g. `"rgba(108,76,245,.08)"`), `size` for label text.

Top-level keys: `addLayer` (a name, creates a layer on top), `renameLayer` (`{"id": "L2", "name": "..."}`), `add`, `remove` (ids from `state`/`wait` output), `update` (list of `{"id": ..., <fields>}` to change existing items in place, e.g. move one with new `x`/`y` or `points`), `clear` (`"claude"`, `"user"`, or `"all"`), `say` (string, added to the chat panel), `ask` (`true` adds **Yes** / **Not quite** buttons under that message; they go away once the user sends).

Other commands:

- `state` lists the items without waiting.
- `check` returns a send that arrived while nobody was waiting, without blocking.
- `undo` reverts the last change by anyone; `redo` brings it back.
- `clear claude` removes only your marks.
- `stop` shuts the server down when the user is done.

## Layers

The canvas has layers (bottom to top), listed in the `wait`/`state` output with each item's layer (`@L2`). The user can reorder, hide, rename, add and delete them; hiding only affects their screen, you always see everything. Items of type `image` are pictures the user pasted (screenshots and the like), screen captures from the toolbar's capture button (on a bottom layer named "Capture"; the user draws on top of them to point at things on screen), or paint-bucket fills (marked `(bucket fill)`); look at them in the PNG. The user can double-click any text or shape label to edit it, so labels you draw may come back changed. Use layers when they help: an alternative on its own layer the user can toggle, annotations kept apart from the drawing. Name them in the user's language. Don't create layers for single marks.

## Style

- Match the doodle's level of detail. One clear step per turn beats a finished diagram nobody asked for.
- Leave the user's intent intact. When you replace their strokes, keep the same position and proportions so the canvas still feels like theirs.
- Write labels and `say` messages in the language the user writes or draws in, not the language of these examples.
- Keep labels short (one to four words). Put explanations in `say` or your reply, not on the canvas.
- Leave room: don't fill the whole canvas. The user should have space to keep drawing.
- If a send arrives with a note, the note wins over your reading of the picture.
- When an instruction the user drew (a check mark, a word like "blue") has been carried out, remove those strokes and every option box you offered, so stale marks don't pile up.

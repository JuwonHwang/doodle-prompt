#!/usr/bin/env node
// Records the intro video (docs/demo.mp4, docs/demo.gif): a rough pipeline sketch that Claude
// cleans up, asks about, and finishes, filmed on a throwaway canvas (see demo-lib.mjs).
//
// usage: node scripts/demo.mjs        (needs Node 22+, Google Chrome and ffmpeg)

import { openDemo, sleep, roughBox, roughArrow } from './demo-lib.mjs';

const d = await openDemo();
await d.record();
await sleep(900);

// 1. A rough pipeline sketch.
for (const x of [110, 420, 730]) { await d.stroke(roughBox(x, 300, 190, 100), 700); await sleep(150); }
for (const [a, b] of [[[305, 350], [412, 350]], [[615, 350], [722, 350]]]) for (const s of roughArrow(a, b)) await d.stroke(s, 220);
await sleep(500);

// 2. A note and Send, with the agent listening.
let heard = d.listen();
await d.click('#note');
await d.type('logs → clean → features, then a model?');
await sleep(400);
await d.click('#send');
await d.delivered(heard, 'the first send');
await sleep(2600);

// 3. The agent cleans it up and asks about the last step.
await d.ops({
  remove: await d.userIds(),
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
await d.click('[data-tool="select"]');
const q = d.page([1075, 350]);
for (const n of [1, 2]) { await d.mouse('mousePressed', q, { clickCount: n, buttons: 1 }); await d.mouse('mouseReleased', q, { clickCount: n }); }
await sleep(300);
await d.evaluate('textInput.select()');
await d.type('two-tower');
await d.key('Enter', 'Enter', 13);
await sleep(700);
heard = d.listen();
await d.click('[data-answer="yes"]');
await d.delivered(heard, 'the Yes answer');
await sleep(2200);

// 5. The agent finishes the model end.
const last = (await d.getState()).items.find((it) => it.type === 'rect' && it.dashed);
await d.ops({
  update: [{ id: last.id, text: 'two-tower model', dashed: false, w: 170 }],
  add: [{ type: 'ellipse', x: 1000, y: 500, w: 170, h: 90, text: 'ranking loss' }, { type: 'arrow', points: [[0, 0], [1, 1]], from: last.id, to: '#0' }],
  say: 'Two-tower model trained with a ranking loss. Ready to build it?',
});
await sleep(2400);

// 6. Moving a box: the arrows follow.
const clean = d.page([515, 350]);
await d.drag(clean, [clean[0], clean[1] + 140]);
await sleep(3200);

await d.finish('demo');
process.exit(0);

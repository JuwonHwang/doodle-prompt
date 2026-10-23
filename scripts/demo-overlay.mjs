#!/usr/bin/env node
// Records the overlay video (docs/demo-overlay.mp4, docs/demo-overlay.gif): marking up a bug right
// on the screen. The "screen" is a made-up desktop with a sample app drawn behind the overlay page,
// so no real screen, file or account ever appears. Filmed on a throwaway canvas (see demo-lib.mjs).
//
// usage: node scripts/demo-overlay.mjs        (needs Node 22+, Google Chrome and ffmpeg)

import { openDemo, sleep, roughEllipse } from './demo-lib.mjs';

// A sample settings page whose long title pushes the Cancel/Save buttons out of the window.
const FAKE_SCREEN = `
<div id="fakeDesktop" style="position:fixed;inset:0;z-index:-1;font:14px/1.4 -apple-system,system-ui,sans-serif;color:#1f2328;
  background:radial-gradient(circle at 20% 20%,#a5b4fc,transparent 55%),radial-gradient(circle at 80% 70%,#f0abfc,transparent 50%),#c7d2fe">
  <div style="position:absolute;left:90px;top:56px;width:960px;height:650px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 24px 70px rgba(30,27,75,.35)">
    <div style="height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#f3f4f6;border-bottom:1px solid #e5e7eb">
      <i style="width:12px;height:12px;border-radius:50%;background:#f87171"></i><i style="width:12px;height:12px;border-radius:50%;background:#fbbf24"></i><i style="width:12px;height:12px;border-radius:50%;background:#34d399"></i>
      <span style="margin-left:14px;padding:4px 14px;background:#fff;border-radius:8px 8px 0 0;font-size:12px;color:#4b5563">Sample App · Settings</span>
    </div>
    <div style="height:36px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #e5e7eb">
      <span style="flex:1;padding:5px 12px;background:#f3f4f6;border-radius:999px;font-size:12px;color:#6b7280">sample-app.example/settings/workspace</span>
    </div>
    <div style="display:flex;height:calc(100% - 74px)">
      <nav style="width:190px;padding:18px 12px;background:#fafafa;border-right:1px solid #eee;display:flex;flex-direction:column;gap:4px;color:#4b5563">
        <b style="padding:6px 10px;color:#111">Settings</b><span style="padding:6px 10px">Profile</span>
        <span style="padding:6px 10px;background:#eef2ff;border-radius:8px;color:#4338ca">Workspace</span><span style="padding:6px 10px">Members</span><span style="padding:6px 10px">Billing</span>
      </nav>
      <main style="flex:1;min-width:0;padding:26px 30px;overflow:hidden">
        <div id="fakeHeader" style="display:flex;align-items:center;gap:10px">
          <h1 id="fakeTitle" style="margin:0;font-size:22px;white-space:nowrap">Workspace notification preferences, sharing settings and default permissions</h1>
          <button style="flex-shrink:0;padding:7px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff">Cancel</button>
          <button style="flex-shrink:0;padding:7px 16px;border:0;border-radius:8px;background:#4f46e5;color:#fff">Save</button>
        </div>
        <p style="color:#6b7280;margin:6px 0 22px">Choose what your workspace hears about and who can see shared items.</p>
        ${['Email digest', 'Mentions and replies', 'Weekly summary', 'New members', 'Shared with link'].map((t, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-top:1px solid #f0f0f0">
          <span>${t}<br><small style="color:#9ca3af">${['Once a day at 9:00', 'When someone mentions you', 'Every Monday', 'When someone joins', 'Anyone with the link can view'][i]}</small></span>
          <span style="width:40px;height:22px;border-radius:999px;background:${i % 3 === 2 ? '#d1d5db' : '#6366f1'};position:relative"><i style="position:absolute;top:3px;${i % 3 === 2 ? 'left:3px' : 'right:3px'};width:16px;height:16px;border-radius:50%;background:#fff"></i></span>
        </div>`).join('')}
      </main>
    </div>
  </div>
</div>`;

const d = await openDemo({ path: '/?overlay' });
await d.evaluate(`document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(FAKE_SCREEN)}); 1`);
await sleep(400);
// The real app sends a capture of the screen under the strokes; here that is a screenshot of the
// made-up screen, taken with the overlay's own UI hidden.
const ui = "['stageBox', 'bar', 'side'].forEach((id) => { document.getElementById(id).style.visibility = VIS; }); 1";
await d.evaluate(ui.replace('VIS', "'hidden'"));
const shot = await d.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
await d.evaluate(ui.replace('VIS', "''"));
await d.evaluate(`(async () => { const img = new Image(); img.src = 'data:image/jpeg;base64,${shot.data}'; await img.decode(); overlayBg = img; return 1; })()`);
const title = await d.evaluate(`(() => { const el = document.getElementById('fakeHeader'), h = el.getBoundingClientRect(), m = el.parentElement.getBoundingClientRect(); return [m.right, h.top + h.height / 2]; })()`);
await d.record();
await sleep(1400);

// 1. Circle the cut-off end of the header in red, and say what's wrong.
await d.click('.swatch[data-color="#d1453b"]');
const [hx, hy] = [title[0], title[1]];  // the right edge of the page, where Save should be
await d.stroke(roughEllipse(hx - 70, hy, 130, 34), 900);
await sleep(400);
let heard = d.listen();
await d.click('#note');
await d.type('The title is cut off and Save is gone');
await sleep(400);
await d.click('#send');
await d.delivered(heard, 'the first send');
await sleep(2600);

// 2. Claude points at the cause and proposes a fix, on the screen itself.
await d.ops({
  add: [
    { type: 'rect', x: 540, y: hy + 100, w: 230, h: 50, text: 'title: truncate with …', dashed: true, fill: 'rgba(255,255,255,.92)' },
    { type: 'rect', x: 540, y: hy + 170, w: 230, h: 50, text: 'buttons: keep their size', dashed: true, fill: 'rgba(255,255,255,.92)' },
    { type: 'arrow', points: [[600, hy + 100], [520, hy + 14]] },
    { type: 'arrow', points: [[770, hy + 195], [hx - 20, hy + 22]] },
  ],
  say: 'The long title pushes Cancel and Save out of the window. Truncate the title and keep the buttons fixed?',
  ask: true,
});
await sleep(3400);

// 3. Yes: the fix lands, and the marks clear away.
heard = d.listen();
await d.click('[data-answer="yes"]');
await d.delivered(heard, 'the Yes answer');
await sleep(1800);
await d.evaluate(`Object.assign(document.getElementById('fakeTitle').style, { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1' }); 1`);
await d.ops({ clear: 'all', say: 'Fixed: the title ends with … and both buttons stay in view.' });
await sleep(2600);

// 4. Fold the overlay into its floating icon and move it out of the way.
await d.click('#foldOverlay');
await sleep(1200);
const fab = await d.evaluate(`(() => { const r = document.getElementById('fab').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
await d.drag(fab, [1330, 760], 24, 35);
await sleep(2400);

await d.finish('demo-overlay');
process.exit(0);

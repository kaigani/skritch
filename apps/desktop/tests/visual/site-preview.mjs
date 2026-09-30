// Capture the real browser editor with original demo artwork for the public website.
// Start `pnpm dev` first. No personal screenshots or external imagery are used.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../../../site/assets/', import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:1420');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__skritch);
  await page.evaluate(async () => {
    const { newBlank } = await import('/src/actions/image.ts');
    const { ui } = await import('/src/state/ui.ts');
    await newBlank();
    const d = window.__skritch.docState();
    const c = document.createElement('canvas');
    c.width = 940;
    c.height = 540;
    const g = c.getContext('2d');
    g.fillStyle = '#f5f0e7';
    g.fillRect(0, 0, 940, 540);
    g.fillStyle = '#1f3533';
    g.font = 'bold 24px sans-serif';
    g.fillText('offscript®', 38, 46);
    g.font = '13px sans-serif';
    g.fillText('PLACES     JOURNAL     ABOUT', 660, 44);
    g.fillStyle = '#58716a';
    g.font = '12px sans-serif';
    g.fillText('A LITTLE FURTHER FROM ORDINARY', 40, 120);
    g.fillStyle = '#213c36';
    g.font = 'bold 65px Georgia';
    g.fillText('Take the', 36, 196);
    g.fillText('scenic route.', 36, 265);
    g.font = '17px sans-serif';
    g.fillStyle = '#64716c';
    g.fillText('Less itinerary. More serendipity.', 40, 312);
    g.fillText('Find a weekend worth getting lost in.', 40, 339);
    g.fillStyle = '#203b34';
    g.beginPath();
    g.roundRect(40, 371, 180, 46, 23);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold 14px sans-serif';
    g.fillText('Find your detour  ↗', 59, 400);
    g.save();
    g.beginPath();
    g.roundRect(495, 89, 408, 394, 190);
    g.clip();
    const sky = g.createLinearGradient(0, 80, 0, 460);
    sky.addColorStop(0, '#f3b878');
    sky.addColorStop(1, '#ede3c0');
    g.fillStyle = sky;
    g.fillRect(490, 80, 420, 420);
    g.fillStyle = '#fff5cc';
    g.beginPath();
    g.arc(735, 169, 43, 0, Math.PI * 2);
    g.fill();
    for (const [color, y] of [
      ['#99a59a', 260],
      ['#648878', 315],
      ['#2c5b4e', 390],
    ]) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(480, 520);
      g.lineTo(480, y);
      g.bezierCurveTo(580, y - 80, 655, y + 40, 730, y - 25);
      g.bezierCurveTo(810, y - 75, 850, y - 15, 920, y - 50);
      g.lineTo(920, 520);
      g.fill();
    }
    g.strokeStyle = '#e9d8ae';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(700, 510);
    g.bezierCurveTo(620, 410, 835, 375, 733, 343);
    g.stroke();
    g.restore();
    g.fillStyle = '#73827a';
    g.font = '11px sans-serif';
    g.fillText('GO SLOW. LOOK CLOSER.', 40, 500);
    const bytes = new Uint8Array(await (await fetch(c.toDataURL())).arrayBuffer());
    const note = document.createElement('canvas');
    note.width = 290;
    note.height = 185;
    const n = note.getContext('2d');
    n.fillStyle = '#fff8dc';
    n.fillRect(0, 0, 290, 185);
    n.fillStyle = '#284d42';
    n.font = 'bold 13px sans-serif';
    n.fillText('THE WEEKEND EDIT', 24, 35);
    n.font = 'bold 32px Georgia';
    n.fillText('Less scrolling.', 24, 82);
    n.fillText('More strolling.', 24, 121);
    n.font = '12px sans-serif';
    n.fillText('Issue 004   /   September', 24, 160);
    const noteBytes = new Uint8Array(await (await fetch(note.toDataURL())).arrayBuffer());
    await d.open({
      ...d.doc,
      canvas: { x: 0, y: 0, w: 1000, h: 610 },
      meta: { ...d.doc.meta, title: '290926:091530_Offscript — Homepage' },
      assets: {
        art: { id: 'art', mime: 'image/png', width: 940, height: 540, bytes },
        note: { id: 'note', mime: 'image/png', width: 290, height: 185, bytes: noteBytes },
      },
      objects: [
        { id: 'base', type: 'image', assetId: 'art', x: 30, y: 30, w: 940, h: 540, opacity: 1 },
        {
          id: 'arrow',
          type: 'arrow',
          from: { x: 380, y: 488 },
          to: { x: 198, y: 430 },
          color: '#fa1262',
          size: 3,
        },
        {
          id: 'label',
          type: 'text',
          pos: { x: 305, y: 505 },
          text: 'Give this a little more pop!',
          color: '#fa1262',
          fontSize: 25,
        },
      ],
    });
    ui().setTool('select');
  });
  const settle = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      const { renderer } = await import('/src/canvas/Renderer.ts');
      renderer.fit();
      renderer.invalidate('all');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  };
  await settle();
  await page.screenshot({ path: `${out}preview-markup.png` });
  await page.evaluate(() => {
    const d = window.__skritch.docState();
    d.execute({
      name: 'Add reference',
      apply(doc) {
        doc.objects.push({
          id: 'note',
          type: 'image',
          assetId: 'note',
          x: 660,
          y: 390,
          w: 290,
          h: 185,
          opacity: 1,
        });
      },
    });
    d.select(['note']);
  });
  await settle();
  await page.screenshot({ path: `${out}preview-layers.png` });
  await page.locator('[data-tool=crop]').click();
  await settle();
  await page.screenshot({ path: `${out}preview-crop.png` });
} finally {
  await browser.close();
}

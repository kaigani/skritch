// Visual review driver: runs scripted flows against the Vite dev server (mocked IPC) and saves
// screenshots to docs/review/. Usage: node tests/visual/shoot.mjs [flow...]
import { chromium, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../../../../docs/review');
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);

// ENGINE=webkit approximates macOS WKWebView (screenshots get a `webkit-` prefix).
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const PREFIX = process.env.ENGINE === 'webkit' ? 'webkit-' : '';
const browser = await ENGINE.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${PREFIX}${name}.png` });
  console.log('saved', name);
};
const canvasBox = async () => page.locator('[data-testid=canvas]').boundingBox();
const drag = async (x0, y0, x1, y1, opts = {}) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = opts.steps ?? 12;
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  await page.mouse.up();
};
const capture = async () => {
  await page.locator('.capture-button').click();
};

const flows = {
  async empty() {
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('.app');
    await shot('01-empty');
  },
  async annotate() {
    await page.goto('http://localhost:1420/');
    await page.evaluate(() =>
      localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
    );
    await page.reload();
    await capture();
    await page.waitForSelector('[data-testid=doc-size]');
    const b = await canvasBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    // arrow
    await page.keyboard.press('a');
    await drag(cx - 260, cy + 140, cx - 60, cy + 10);
    // rectangle
    await page.keyboard.press('s');
    await drag(cx + 20, cy - 150, cx + 260, cy - 20);
    // ellipse in green
    await page.keyboard.press('Escape');
    await page.getByTestId('swatch').click();
    await page.getByRole('button', { name: '#4cd964' }).click();
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=shape]').click();
    await page.getByRole('button', { name: 'Ellipse' }).click();
    await drag(cx - 300, cy - 180, cx - 120, cy - 90);
    // highlighter
    await page.keyboard.press('Escape');
    await page.getByTestId('swatch').click();
    await page.getByRole('button', { name: '#ffcc00' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('h');
    await drag(cx - 250, cy + 60, cx + 150, cy + 60, { steps: 20 });
    // pen
    await page.keyboard.press('Escape');
    await page.getByTestId('swatch').click();
    await page.getByRole('button', { name: '#007aff' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('p');
    await page.mouse.move(cx + 120, cy + 120);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(cx + 120 + i * 5, cy + 120 + Math.sin(i / 3) * 18);
    await page.mouse.up();
    // stamp
    await page.keyboard.press('Escape');
    await page.getByTestId('swatch').click();
    await page.getByRole('button', { name: '#fa1262' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('k');
    await page.mouse.click(cx + 300, cy - 170);
    // pixelate
    await page.keyboard.press('b');
    await drag(cx - 240, cy - 60, cx - 20, cy - 20);
    // text
    await page.keyboard.press('t');
    await page.mouse.click(cx + 40, cy + 170);
    await page.keyboard.type('Ship it!');
    await shot('02-text-editing');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(b.x + 20, b.y + 20);
    await shot('03-annotated');
  },
  async addToCanvas() {
    await flows.annotate();
    await capture();
    await page.waitForSelector('[role=dialog]');
    await shot('04-arrival-dialog');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await shot('05-added-layer');
    // drag the new layer off the right edge → canvas grows (dashed proposal while dragging)
    const b = await canvasBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) await page.mouse.move(cx + i * 22, cy + i * 8);
    await shot('06-dragging-past-edge');
    await page.mouse.up();
    await shot('07-canvas-extended');
    await page.keyboard.press('Control+z');
    await shot('08-undo-extension');
  },
  async crop() {
    await flows.annotate();
    await page.keyboard.press('c');
    await page.waitForSelector('[data-testid=cropbar]');
    await shot('09-crop-start');
    // capture #1 is 800x520 shown at 100 %, centred in the stage
    const b = await canvasBox();
    const x0 = b.x + (b.width - 800) / 2;
    const y0 = b.y + (b.height - 520) / 2;
    // pull the bottom-right handle outward: grows the canvas beyond the image
    await drag(x0 + 800, y0 + 520, x0 + 800 + 140, y0 + 520 + 90);
    // pull the left handle inward: crops
    await drag(x0, y0 + 260, x0 + 100, y0 + 260);
    await shot('10-crop-grow-preview');
    await page.keyboard.press('Enter');
    await shot('11-crop-applied');
    await page.keyboard.press('c');
    await page.getByRole('tab', { name: 'Canvas' }).click();
    await page.getByLabel('Width').fill('1100');
    await page.getByLabel('Anchor 5').click();
    await shot('11b-canvas-numeric');
    await page.getByRole('button', { name: 'Cancel' }).click();
  },
  async video() {
    await page.goto('http://localhost:1420/');
    await page.evaluate(() =>
      localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
    );
    await page.reload();
    await page.waitForSelector('.app'); // listeners mount with the app; earlier drops would be lost
    await page.waitForTimeout(300);
    for (const stem of ['clipA', 'clipB']) {
      // WebKit on Windows can't decode VP9 or play blob: media, so it gets H.264 over http.
      await page.evaluate(
        async ([s, remote]) => {
          const m = window.__skritchMock;
          const path = remote
            ? await m.putRemote(`${s}.mp4`, `/tests/fixtures/${s}.mp4`)
            : m.putFile(
                `${s}.webm`,
                new Uint8Array(await (await fetch(`/tests/fixtures/${s}.webm`)).arrayBuffer()),
                'video/webm',
              );
          m.emit('files://dropped', { paths: [path], source: 'window' });
        },
        [stem, !!PREFIX],
      );
      await page.waitForTimeout(1500);
    }
    await page.waitForSelector('[data-testid=timecode]');
    await page.waitForTimeout(800);
    await shot('12-video-mode');
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('i');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('o');
    await page.waitForTimeout(500);
    await shot('13-video-markers');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    await shot('14-video-deleted');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(1200);
    await shot('15-frame-as-image');
    await page.getByRole('button', { name: /Back to Video/ }).click();
    await page.waitForTimeout(600);
    await shot('16-back-to-video');
  },
};

for (const [name, f] of Object.entries(flows)) {
  if (want.length && !want.includes(name)) continue;
  try {
    await f();
  } catch (e) {
    console.error(`flow ${name} failed:`, e.message);
    await page.screenshot({ path: `${OUT}/FAIL-${name}.png` });
  }
}
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();

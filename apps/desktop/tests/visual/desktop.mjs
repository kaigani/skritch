// Drives the REAL desktop app (Tauri + WebView2) over CDP. Launch skritch.exe with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 first.
// Usage: node tests/visual/desktop.mjs <exe> <clip1> <clip2>
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const [exe, clipA, clipB] = process.argv.slice(2);
const OUT = resolve(import.meta.dirname, '../../../../docs/review');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
};
const text = (sel) => page.locator(sel).innerText();

// dismiss the first-run tip if shown
const tip = page.getByRole('button', { name: 'Got it' });
if (await tip.count()) await tip.click();

// 1. second-instance argv → files://dropped {source:'args'} → video mode (ffprobe + asset protocol)
execFile(exe, [clipA, clipB]);
await page.getByTestId('frame-counter').waitFor({ timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll('.block').length === 2, null, { timeout: 20000 });
await page.waitForTimeout(1500); // thumbnails
console.log(
  'counter:',
  await text('[data-testid=frame-counter]'),
  '| summary:',
  await text('[data-testid=video-summary]'),
);
await shot('23-desktop-video-mode');

// 2. frame stepping across the clip boundary (clip A = 120 frames)
await page
  .locator('body')
  .click({ position: { x: 5, y: 300 } })
  .catch(() => {});
await page.keyboard.press('End');
await page.keyboard.press('Home');
for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(600);
console.log('after stepping:', await text('[data-testid=frame-counter]'));
await shot('24-desktop-video-frame-119');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
console.log('after boundary:', await text('[data-testid=frame-counter]'));
await shot('25-desktop-video-frame-120-clipB');

// 3. mark + delete + split, then play briefly
await page.keyboard.press('Home');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('i');
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.press('o');
await page.waitForTimeout(300);
await shot('26-desktop-video-marked');
await page.keyboard.press('Delete');
await page.waitForTimeout(500);
console.log('after delete:', await text('[data-testid=frame-counter]'));
await page.keyboard.press('Space');
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
console.log('after play:', await text('[data-testid=frame-counter]'));

// 4. frame → image mode (ffmpeg frame_png from the original), annotate, copy to clipboard (arboard)
await page.keyboard.press('Control+Enter');
await page.getByRole('button', { name: /Back to Video/ }).waitFor();
await page.waitForTimeout(500);
const box = await page.getByTestId('canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.keyboard.press('a');
await page.mouse.move(cx - 200, cy + 120);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cx - 200 + i * 18, cy + 120 - i * 12);
await page.mouse.up();
await page.keyboard.press('t');
await page.mouse.click(cx + 20, cy - 60);
await page.locator('textarea.text-editor').waitFor();
await page.keyboard.type('Frame 42');
await page.keyboard.press('Escape');
await shot('27-desktop-frame-annotated');
await page.keyboard.press('Control+c');
await page.waitForTimeout(800);
console.log('toast:', await page.locator('.toast').allInnerTexts());

// 5. paste it back: clipboard_read_image → arrival dialog → Add to Canvas
await page.keyboard.press('Control+v');
await page.getByRole('dialog').waitFor({ timeout: 5000 });
await shot('28-desktop-paste-arrival');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
console.log('size after paste:', await text('[data-testid=doc-size]'));
await shot('29-desktop-paste-added');

if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();

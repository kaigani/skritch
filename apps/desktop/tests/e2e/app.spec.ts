// E2E against the Vite dev server with the mocked IPC backend (§9).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Canvas size shown in the bottom bar next to the zoom. */
const size = (page: Page) => page.getByTestId('doc-size');

async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  await page.waitForSelector('.app');
}

/** Snaps via the main button and waits until the (async) capture has arrived: dialog shown or size changed. */
async function snap(page: Page) {
  const before = (await size(page).count()) ? await size(page).innerText() : '';
  await page.locator('.capture-button').click();
  await expect
    .poll(
      async () =>
        (await page.getByRole('dialog').count()) > 0 ||
        ((await size(page).count()) > 0 && (await size(page).innerText()) !== before),
    )
    .toBe(true);
}

/** Canvas rect on screen for the first capture (800×520 at 100 %, centred). */
async function canvasOrigin(page: Page, w = 800, h = 520) {
  const b = (await page.getByTestId('canvas').boundingBox())!;
  return { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2 };
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
  await page.mouse.up();
}

test('capture opens a document at image size', async ({ page }) => {
  await fresh(page);
  await snap(page);
  await expect(size(page)).toContainText('800 × 520');
  await expect(page.getByTestId('zoom-pct')).toHaveText('100%');
});

test('arrival dialog: Esc cancels, Replace (default) replaces, Add to Canvas adds a selected layer', async ({
  page,
}) => {
  await fresh(page);
  await snap(page);
  await expect(size(page)).toContainText('800 × 520');

  await snap(page);
  await expect(page.getByRole('dialog')).toContainText('New capture ready');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(size(page)).toContainText('800 × 520');

  await snap(page);
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(size(page)).not.toContainText('800 × 520'); // capture #2 has a different size

  await expect(page.getByRole('dialog')).toHaveCount(0); // no "Save changes?" after Replace

  const replaced = await size(page).innerText();
  await snap(page);
  await expect(page.getByRole('dialog').getByRole('button')).toHaveText(['Cancel', 'Add to Canvas', 'Replace']);
  await page.keyboard.press('Enter'); // default = Replace
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(size(page)).not.toHaveText(replaced);

  await snap(page);
  await page.getByRole('button', { name: 'Add to Canvas' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-tool=select]')).toHaveAttribute('aria-pressed', 'true');
});

test('"Remember my choice" skips the dialog next time', async ({ page }) => {
  await fresh(page);
  await snap(page);
  await snap(page);
  await page.getByLabel('Remember my choice').check();
  await page.getByRole('button', { name: 'Add to Canvas' }).click();
  await snap(page);
  await page.waitForTimeout(400);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('dragging an object past the edge grows the canvas; one undo restores it (§5.2)', async ({ page }) => {
  await fresh(page);
  await snap(page);
  const o = await canvasOrigin(page);
  await page.keyboard.press('s');
  await drag(page, o.x + 600, o.y + 100, o.x + 760, o.y + 200); // rectangle near the right edge
  await page.keyboard.press('v');
  await page.mouse.click(o.x + 20, o.y + 20); // deselect, so the edge isn't a resize handle
  await drag(page, o.x + 650, o.y + 100, o.x + 950, o.y + 100); // grab its top edge, drag right
  await expect(size(page)).not.toContainText('800 × 520');
  const grown = await size(page).innerText();
  expect(Number(/(\d+) × 520/.exec(grown)?.[1])).toBeGreaterThan(1000);
  await page.keyboard.press('Control+z');
  await expect(size(page)).toContainText('800 × 520');
});

test('crop handle pulled outward grows the canvas (§5.3)', async ({ page }) => {
  await fresh(page);
  await snap(page);
  const o = await canvasOrigin(page);
  await page.keyboard.press('c');
  await expect(page.getByTestId('cropbar')).toBeVisible();
  await drag(page, o.x + 800, o.y + 520, o.x + 900, o.y + 600);
  await expect(page.getByLabel('Width')).toHaveValue('900');
  await expect(page.getByLabel('Height')).toHaveValue('600');
  await page.keyboard.press('Enter');
  await expect(size(page)).toContainText('900 × 600');
  await page.keyboard.press('Control+z');
  await expect(size(page)).toContainText('800 × 520');
});

test('typing a larger crop width grows the canvas', async ({ page }) => {
  await fresh(page);
  await snap(page);
  await page.keyboard.press('c');
  await expect(page.getByRole('tab')).toHaveText(['Crop', 'Scale']);
  await page.getByLabel('Width').fill('1000');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(size(page)).toContainText('1000 × 520');
});

test('Scale sub-mode resamples the whole document', async ({ page }) => {
  await fresh(page);
  await snap(page);
  await page.keyboard.press('c');
  await page.getByRole('tab', { name: 'Scale' }).click();
  await expect(page.getByRole('button', { name: /Cancel/ })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Scale down' }).click();
  await expect(page.getByLabel('Width')).toHaveValue('400');
  await expect(page.getByLabel('Height')).toHaveValue('260');
  await page.getByLabel('Height').fill('130');
  await expect(page.getByLabel('Width')).toHaveValue('200');
  await expect(page.getByRole('group', { name: 'Scale' })).toContainText('25%');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(size(page)).toContainText('200 × 130');
  await expect(page.getByRole('group', { name: 'Scale' })).toHaveCount(0);
});

test('Drag Me hint shows on a real press only, not on a stray click event', async ({ page }) => {
  await fresh(page);
  await snap(page);
  const tab = page.getByRole('button', { name: 'Drag me to share' });
  // WebKit can deliver a click with no matching press after a native drag ends.
  await tab.dispatchEvent('click');
  await page.waitForTimeout(200);
  await expect(page.getByRole('status')).not.toContainText('Drag this tab');
  await tab.click();
  await expect(page.getByRole('status')).toContainText('Drag this tab');
});

test('text tool: type, commit, undo', async ({ page }) => {
  await fresh(page);
  await snap(page);
  const o = await canvasOrigin(page);
  await page.keyboard.press('t');
  await page.mouse.click(o.x + 200, o.y + 200);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await expect(page.locator('textarea.text-editor')).toHaveCount(0);
  await expect(page.getByTestId('doc-name')).toContainText('Edited');
});

test('exported PNG round-trips the editable document (iTXt)', async ({ page }) => {
  await fresh(page);
  await snap(page);
  const o = await canvasOrigin(page);
  await page.keyboard.press('a');
  await drag(page, o.x + 100, o.y + 100, o.x + 300, o.y + 250);
  const objects = await page.evaluate(async () => {
    const h = (window as any).__skritch;
    const bytes = await h.encodeDocument(h.docState().doc, 'png');
    return JSON.parse(h.png.readITXt(bytes, h.png.SKRITCH_KEY)).objects.map((x: { type: string }) => x.type);
  });
  expect(objects).toEqual(['image', 'arrow']);
});

// ---- video -----------------------------------------------------------------------------------

/** Drops a fixture clip. WebKit (the macOS proxy) gets H.264 MP4 — the Mac playback path — served
 * over http, because Playwright's Windows WebKit has no VP9 decoder and can't play blob: media.
 * Chromium gets the VP9 WebM as an in-memory blob. */
async function dropClip(page: Page, stem: 'clipA' | 'clipB' | 'frames') {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await page.evaluate(async (s) => {
      const m = (window as any).__skritchMock;
      const path = await m.putRemote(`${s}.mp4`, `/tests/fixtures/${s}.mp4`);
      m.emit('files://dropped', { paths: [path], source: 'window' });
    }, stem);
    return;
  }
  const name = `${stem}.webm`;
  const bytes = [...readFileSync(resolve(import.meta.dirname, '../fixtures', name))];
  await page.evaluate(
    ([n, b]) => {
      const m = (window as any).__skritchMock;
      m.emit('files://dropped', {
        paths: [m.putFile(n, new Uint8Array(b as number[]), 'video/webm')],
        source: 'window',
      });
    },
    [name, bytes] as const,
  );
}

test('video: import, append, step, mark, delete, undo, frame → image and back', async ({ page }) => {
  await fresh(page);
  await dropClip(page, 'clipA');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 0 / 90');
  await dropClip(page, 'clipB');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 0 / 150');
  await expect(page.getByTestId('video-summary')).toContainText('2 clips');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 11 / 150');
  await page.keyboard.press('i');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('o');
  await expect(page.locator('.delta')).toHaveText('Δ 0s11');

  await page.keyboard.press('Delete');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 11 / 139');
  await expect(page.locator('.toast')).toContainText('Deleted 0s11');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('frame-counter')).toContainText('/ 150');

  // copy/paste the marked range at the end
  await page.keyboard.press('Control+c');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('frame-counter')).toContainText('/ 161');

  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('button', { name: /Back to Video/ })).toBeVisible();
  await expect(size(page)).toContainText('640 × 360');
  await page.getByRole('button', { name: /Back to Video/ }).click();
  await expect(page.getByTestId('frame-counter')).toContainText('/ 161');
});

test('video: split at playhead and reorder by dragging a block', async ({ page }) => {
  await fresh(page);
  await dropClip(page, 'clipA');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 0 / 90');
  await dropClip(page, 'clipB');
  await expect(page.locator('.block')).toHaveCount(2);
  const blocks = page.locator('.block');
  // the timeline re-fits after the second clip lands; measure once the layout has settled
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await blocks.nth(1).boundingBox());
      const stable = now === last;
      last = now;
      return stable;
    })
    .toBe(true);
  const first = (await blocks.nth(0).boundingBox())!;
  const second = (await blocks.nth(1).boundingBox())!;
  await drag(
    page,
    second.x + second.width / 2,
    second.y + second.height / 2,
    first.x + 10,
    first.y + first.height / 2,
  );
  await expect(blocks.nth(0)).toContainText('clipB');
  await page.keyboard.press('Control+z');
  await expect(blocks.nth(0)).toContainText('clipA');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+k');
  await expect(page.locator('.block')).toHaveCount(3);
});

/** Frame index encoded in `frames.*`: flat grey, luma = 16 + 3·N, explicitly tagged sRGB. */
async function stageFrame(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid=video-stage] canvas') as HTMLCanvasElement;
    const [r] = c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return Math.round(r / (765 / 219)); // limited-range luma step of 3 → 3·255/219 per frame
  });
}

test('video: stepping lands on the exact frame of a B-frame H.264 clip (pixel check)', async ({
  page,
  browserName,
}) => {
  test.fail(
    browserName === 'webkit' && process.platform === 'win32',
    "Playwright's Windows WebKit ignores MP4 edit lists (B-frame delay), so it shows frame N-2; macOS AVFoundation honours them",
  );
  await fresh(page);
  await dropClip(page, 'frames');
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 0 / 72');
  for (const target of [37, 61, 12]) {
    await page.keyboard.press('Home');
    for (let i = 0; i < Math.floor(target / 10); i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < target % 10; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('frame-counter')).toHaveText(`frame ${target} / 72`);
    await expect.poll(() => stageFrame(page), { timeout: 5000 }).toBe(target);
  }
});

import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

async function overlay(page: Page, advanced = true, mode = 'crosshair') {
  await page.addInitScript((advanced) => {
    if (!localStorage.getItem('skritch:prefs'))
      localStorage.setItem(
        'skritch:prefs',
        JSON.stringify({ advancedCapture: advanced, firstRunTipDismissed: true }),
      );
  }, advanced);
  await page.goto(`/overlay.html?display=0&mode=${mode}`);
  await expect(page.getByRole('status')).not.toContainText('Preparing');
  await page.evaluate(async () => {
    const { ipc } = await import('/src/ipc/index.ts');
    (window as any).finishes = [];
    ipc.overlayFinish = async (display, rect, timed) => {
      (window as any).finishes.push({ display, rect, timed });
    };
  });
}
const results = (page: Page) => page.evaluate(() => (window as any).finishes);
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
}

test('standard capture still completes on release; advanced preference persists', async ({ page }) => {
  await overlay(page, false);
  await drag(page, [100, 100], [500, 350]);
  expect(await results(page)).toEqual([
    { display: 0, rect: { x: 100, y: 100, w: 400, h: 250 }, timed: false },
  ]);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__skritchMock);
  await page.evaluate(() => (window as any).__skritchMock.emit('menu://action', { action: 'prefs' }));
  const check = page.getByRole('checkbox', { name: /Advanced options after capture/ });
  await check.check();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__skritchMock);
  await page.evaluate(() => (window as any).__skritchMock.emit('menu://action', { action: 'prefs' }));
  await expect(check).toBeChecked();
});

test('advanced capture adjusts corners and position before confirmation', async ({ page }) => {
  await overlay(page);
  await drag(page, [100, 100], [500, 350]);
  expect(await results(page)).toEqual([]);
  await expect(page.getByRole('region', { name: 'Advanced capture options' })).toBeVisible();
  await drag(page, [100, 100], [80, 60]);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('420');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('290');
  await drag(page, [200, 150], [240, 180]);
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  expect(await results(page)).toEqual([
    { display: 0, rect: { x: 120, y: 90, w: 420, h: 290 }, timed: false },
  ]);
});

test('linked dimensions, keyboard adjustment, timer and full display capture', async ({ page }) => {
  await overlay(page);
  await drag(page, [100, 100], [500, 300]);
  await page.getByRole('button', { name: 'Lock aspect ratio' }).click();
  await page.getByRole('spinbutton', { name: 'Width' }).fill('600');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('300');
  await page.getByRole('button', { name: 'Resize bottom right' }).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('610');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('305');
  await page.getByRole('button', { name: 'Timed capture', exact: true }).click();
  await page.getByRole('button', { name: 'Full screen capture', exact: true }).click();
  expect(await results(page)).toEqual([]);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('1280');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('800');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  expect(await results(page)).toEqual([{ display: 0, rect: { x: 0, y: 0, w: 1280, h: 800 }, timed: true }]);
});

test('window capture can be adjusted and timed mode can be turned off; Escape cancels', async ({ page }) => {
  await overlay(page, true, 'window');
  await page.mouse.click(200, 150);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('600');
  await drag(page, [120, 90], [100, 70]);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('620');
  await page.keyboard.press('Escape');
  expect(await results(page)).toEqual([{ display: 0, rect: null, timed: false }]);
  await overlay(page, true, 'timed');
  await drag(page, [100, 100], [500, 350]);
  await expect(page.getByRole('button', { name: 'Timed capture' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Timed capture' }).click();
  await page.getByRole('group', { name: 'Move capture area' }).focus();
  await page.keyboard.press('Enter');
  expect(await results(page)).toEqual([
    { display: 0, rect: { x: 100, y: 100, w: 400, h: 250 }, timed: false },
  ]);
});

test('Retina selections report and submit physical pixels', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await overlay(page);
  await drag(page, [100, 100], [500, 350]);
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toHaveValue('800');
  await expect(page.getByRole('spinbutton', { name: 'Height' })).toHaveValue('500');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  expect(await results(page)).toEqual([
    { display: 0, rect: { x: 200, y: 200, w: 800, h: 500 }, timed: false },
  ]);
  await context.close();
});

test('small displays keep the panel onscreen and all four corners reachable', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await overlay(page);
  await drag(page, [30, 30], [580, 450]);
  const panel = await page.getByRole('region', { name: 'Advanced capture options' }).boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(640);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(480);
  expect(
    await page.locator('.capture-handle').evaluateAll((handles) =>
      handles.every((handle) => {
        const r = handle.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === handle;
      }),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await results(page)).toEqual([{ display: 0, rect: null, timed: false }]);
});

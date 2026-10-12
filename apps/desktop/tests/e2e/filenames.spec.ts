import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ timezoneId: 'America/Los_Angeles' });

test('capture names are stable, editable, cancelable, and shared by Save and Drag Me', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-29T15:23:10Z'));
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  // Desktop Chrome's Playwright profile uses a Windows UA; Safari uses macOS.
  const separator = await page.evaluate(() => (/Windows/.test(navigator.userAgent) ? '_' : ':'));
  const capturedName = `290926${separator}082310_Quarterly report`;
  await page.locator('.capture-button').click();
  const filename = page.getByRole('button', { name: 'Edit filename', exact: true });
  await expect(filename).toHaveText(capturedName);
  await page.clock.setFixedTime(new Date('2026-09-29T16:00:00Z'));
  await filename.click();
  const input = page.getByRole('textbox', { name: 'Filename', exact: true });
  await input.fill('Cancel this');
  await input.press('Escape');
  await expect(filename).toHaveText(capturedName);
  await filename.click();
  await input.fill('Final markup.png');
  await input.press('Enter');
  await expect(filename).toHaveText('Final markup');
  await expect(page.getByTestId('doc-name')).toContainText('Final markup');
  await page.getByRole('button', { name: /Share/ }).click();
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /^Save As/ }).click();
  expect((await firstDownload).suggestedFilename()).toBe('Final markup.png');

  // Renaming a saved image must make Save use the new name, leaving the old file intact.
  await filename.click();
  await input.fill('My revised name');
  await page.getByRole('button', { name: /Share/ }).click(); // blur commits
  await expect(filename).toHaveText('My revised name');
  const secondDownload = page.waitForEvent('download');
  await page
    .getByRole('menuitem', { name: /^Save(?:\s|$)/ })
    .first()
    .click();
  expect((await secondDownload).suggestedFilename()).toBe('My revised name.png');

  const tab = page.getByRole('button', { name: 'Drag me to share' });
  await tab.hover();
  await expect
    .poll(() =>
      tab.evaluate((el) => {
        const transfer = new DataTransfer();
        el.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
        return transfer.getData('DownloadURL');
      }),
    )
    .toContain('image/png:My revised name.png:blob:');
});

test('video drag formats and editable filenames export the current still frame', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  const ext = browserName === 'webkit' ? 'mp4' : 'webm';
  const bytes = [...readFileSync(resolve(import.meta.dirname, `../fixtures/frames.${ext}`))];
  await page.evaluate(
    ([name, data]) => {
      const m = (window as any).__skritchMock;
      m.emit('files://dropped', {
        paths: [
          m.putFile(name, new Uint8Array(data as number[]), `video/${name.endsWith('mp4') ? 'mp4' : 'webm'}`),
        ],
        source: 'window',
      });
    },
    [`frames.${ext}`, bytes] as const,
  );
  await expect(page.getByTestId('frame-counter')).toHaveText('frame 0 / 72');
  const filename = page.getByRole('button', { name: 'Edit filename', exact: true });
  const input = page.getByRole('textbox', { name: 'Filename', exact: true });
  await filename.click();
  await input.fill('Discard this');
  await input.press('Escape');
  await expect(filename).toHaveText('Untitled Video');
  await filename.click();
  await input.fill('Final video.mov');
  await input.press('Enter');
  await expect(filename).toHaveText('Final video');
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.userAgent) ? 'Meta' : 'Control'));
  await page.keyboard.press(`${modifier}+z`);
  await expect(filename).toHaveText('Untitled Video');
  await page.keyboard.press(`${modifier}+Shift+z`);
  await expect(filename).toHaveText('Final video');
  const selector = page.getByRole('button', { name: 'Drag format', exact: true });
  await expect(selector).toContainText('MP4');
  await selector.click();
  await page.getByRole('menuitem', { name: /^\s*MOV$/ }).click();
  await expect(selector).toContainText('MOV');
  await selector.click();
  await page.getByRole('menuitem', { name: /^\s*PNG$/ }).click();
  await page.keyboard.press('ArrowRight');
  const tab = page.getByRole('button', { name: 'Drag me to share' });
  await tab.hover();
  const payload = () =>
    tab.evaluate((el) => {
      const dataTransfer = new DataTransfer();
      el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      return dataTransfer.getData('DownloadURL');
    });
  await expect.poll(payload).toContain('image/png:Final video.png:blob:');
  const pngUrl = (await payload()).split(':').slice(2).join(':');
  const frameBytes = await page.evaluate(
    async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
    pngUrl,
  );
  expect(frameBytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await filename.click();
  await input.fill('Selected frame.jpg');
  await selector.click(); // blur commits
  await expect(filename).toHaveText('Selected frame');
  await page.getByRole('menuitem', { name: /^\s*JPG$/ }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await tab.hover();
  await expect.poll(payload).toContain('image/jpeg:Selected frame.jpg:blob:');
  const jpgUrl = (await payload()).split(':').slice(2).join(':');
  const jpgBytes = await page.evaluate(
    async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
    jpgUrl,
  );
  expect(jpgBytes.slice(0, 2)).toEqual([255, 216]);
  await page.getByRole('button', { name: /^Share/ }).click();
  await page.getByRole('menuitem', { name: /^Export Video/ }).click();
  await expect(page.getByRole('dialog', { name: 'Export Video' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /^Share/ }).click();
  const saved = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /^Save Video Project/ }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe('Selected frame.skritchv');
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8')).title).toBe('Selected frame');
});

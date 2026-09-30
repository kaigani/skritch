import { expect, test } from '@playwright/test';

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
  await expect(page.getByTestId('title')).toContainText('Final markup');
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

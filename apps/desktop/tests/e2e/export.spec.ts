import { expect, test } from '@playwright/test';

test('Drag Me follows the selected format and does not substitute unsupported formats', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  const tab = page.getByRole('button', { name: 'Drag me to share' });
  await expect(tab).toBeDisabled();
  await page.getByRole('button', { name: 'Blank Canvas', exact: true }).click();
  await expect(tab).toBeEnabled();

  for (const format of ['PNG', 'JPG']) {
    await page.getByRole('button', { name: 'Drag format', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(format) }).click();
    await expect(tab).toHaveAttribute('title', new RegExp(`Drag ${format} to Finder`));
    await tab.hover();
    // Inspect the real dragstart payload, including the encoded file's signature.
    await expect
      .poll(async () =>
        tab.evaluate(async (el) => {
          const transfer = new DataTransfer();
          el.dispatchEvent(
            new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }),
          );
          const payload = transfer.getData('DownloadURL');
          if (!payload) return null;
          const [, mime, name, url] = /^([^:]+):([^:]+):(.*)$/.exec(payload)!;
          const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
          return { mime, extension: name.split('.').pop(), signature: [...bytes.slice(0, 2)] };
        }),
      )
      .toEqual(
        format === 'PNG'
          ? { mime: 'image/png', extension: 'png', signature: [137, 80] }
          : { mime: 'image/jpeg', extension: 'jpg', signature: [255, 216] },
      );
  }

  await page.getByRole('button', { name: 'Drag format', exact: true }).click();
  await page.getByRole('menuitem', { name: /PDF/ }).click();
  await tab.hover();
  await expect(page.locator('.toast')).toContainText('PDF export needs the desktop app');
  expect(
    await tab.evaluate((el) => {
      const transfer = new DataTransfer();
      el.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      return transfer.getData('DownloadURL');
    }),
  ).toBe('');
});

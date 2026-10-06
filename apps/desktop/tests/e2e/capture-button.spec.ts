import { expect, test } from '@playwright/test';

test('permission failures explain an already-enabled setting without repeated blocking alerts', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__skritchMock);
  const denied = () =>
    page.evaluate(() =>
      (window as any).__skritchMock.emit('capture://error', { code: 'permission', message: 'No access' }),
    );
  await denied();
  const dialog = page.getByRole('alertdialog', { name: 'Screen Recording unavailable' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('If it is already enabled');
  await dialog.getByRole('button', { name: 'Not Now' }).click();
  await denied();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('quit and reopen Skritch');
  await expect(page.getByRole('status').getByRole('button', { name: 'Settings' })).toBeVisible();
  // Permission recovery is checked on every capture; a later revocation can explain itself again.
  await page.locator('.capture-button').click();
  await expect(page.getByTestId('doc-size')).toContainText('800 × 520');
  await denied();
  await expect(dialog).toBeVisible();
});

test('split capture button runs directly and remembers the menu selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'skritch:prefs',
      JSON.stringify({
        firstRunTipDismissed: true,
        captureArrival: 'replace',
      }),
    ),
  );
  await page.reload();
  const main = page.locator('.capture-button');
  const arrow = page.getByRole('button', { name: 'Choose capture action', exact: true });
  const menu = page.getByRole('menu', { name: 'Capture action', exact: true });
  const title = page.getByTestId('doc-size');

  await main.click();
  await expect(title).toContainText('800 × 520');
  await expect(menu).toHaveCount(0);
  await arrow.click();
  await expect(menu.getByRole('menuitemradio', { name: /^Screen Snap/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemradio', { name: /^Fullscreen Snap/ }).click();
  await expect(main).toHaveText('Fullscreen Snap');
  await expect(title).toContainText('800 × 520'); // Choosing does not trigger a capture.
  await expect(menu).toHaveCount(0);

  await page.reload();
  await expect(main).toHaveText('Fullscreen Snap');
  await main.focus();
  await main.press('Enter');
  await expect(title).toContainText('1440 × 900');

  await arrow.focus();
  await arrow.press('ArrowDown');
  const fullscreen = menu.getByRole('menuitemradio', { name: /^Fullscreen Snap/ });
  await expect(fullscreen).toBeFocused();
  await fullscreen.press('ArrowDown');
  const window = menu.getByRole('menuitemradio', { name: /^Window Snap/ });
  await expect(window).toBeFocused();
  await window.press('Enter');
  await expect(main).toHaveText('Window Snap');
  await expect(title).toContainText('1440 × 900');
  await main.press('Space');
  await expect(title).toContainText('900 × 600');

  await arrow.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(arrow).toBeFocused();
  await arrow.click();
  await arrow.click();
  await expect(menu).toHaveCount(0);
});

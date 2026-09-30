import { expect, test, type Page } from '@playwright/test';

async function menu(page: Page, action: string) {
  await page.evaluate((action) => (window as any).__skritchMock.emit('menu://action', { action }), action);
}

test('Image menu reorders selected layers one step or to either end, with undo and redo', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  await page.locator('.capture-button').click();
  await expect(page.getByTestId('title')).toContainText('800 × 520');
  await page.evaluate(() => {
    const d = (window as any).__skritch.docState();
    d.execute({
      name: 'Set up overlapping images',
      apply(doc: any) {
        const image = doc.objects[0];
        doc.objects = ['a', 'b', 'c', 'd'].map((id) => ({ ...image, id }));
      },
    });
    d.select(['b']);
  });
  const order = () =>
    page.evaluate(() =>
      (window as any).__skritch
        .docState()
        .doc.objects.map((o: any) => o.id)
        .join(''),
    );
  await menu(page, 'order-forward');
  await expect.poll(order).toBe('acbd');
  await menu(page, 'undo');
  await expect.poll(order).toBe('abcd');
  await menu(page, 'redo');
  await expect.poll(order).toBe('acbd');
  await menu(page, 'order-front');
  await expect.poll(order).toBe('acdb');
  await menu(page, 'order-backward');
  await expect.poll(order).toBe('acbd');
  await menu(page, 'order-back');
  await expect.poll(order).toBe('bacd');
  // Multiple selections move together without changing their relative order.
  await page.evaluate(() => (window as any).__skritch.docState().select(['b', 'a']));
  await menu(page, 'order-front');
  await expect.poll(order).toBe('cdba');
  await menu(page, 'undo');
  await expect.poll(order).toBe('bacd');
  await page.evaluate(() => (window as any).__skritch.docState().select([]));
  await menu(page, 'order-front');
  await expect.poll(order).toBe('bacd');
});

test('native menu actions edit, copy/paste layers, transform, clear annotations, and undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  await page.locator('.capture-button').click();
  await expect(page.getByTestId('title')).toContainText('800 × 520');
  await page.waitForFunction(() => !!(window as any).__skritch);
  await menu(page, 'select-all');
  await expect.poll(() => page.evaluate(() => (window as any).__skritch.docState().selection.length)).toBe(1);
  await menu(page, 'copy');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritchMock.readClipboardText()))
    .toContain('Skritch objects');
  await menu(page, 'clipboard');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritch.docState().doc.objects.length))
    .toBe(2);
  await menu(page, 'undo');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritch.docState().doc.objects.length))
    .toBe(1);
  await menu(page, 'redo');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritch.docState().doc.objects.length))
    .toBe(2);
  await page.evaluate(() => (window as any).__skritch.docState().select(['not-an-object']));
  await menu(page, 'tool-crop');
  await expect(page.getByTestId('crop-target')).toHaveText('Image');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as any).__skritch.docState().select([]));
  await menu(page, 'rotate-cw');
  await expect(page.getByTestId('title')).toContainText('520 × 800');
  await menu(page, 'undo');
  await expect(page.getByTestId('title')).toContainText('800 × 520');
  await page.evaluate(() => {
    const d = (window as any).__skritch.docState();
    d.execute({
      name: 'Add test annotation',
      apply(doc: any) {
        doc.objects.push({
          id: 'arrow',
          type: 'arrow',
          from: { x: 10, y: 10 },
          to: { x: 60, y: 60 },
          color: '#fa1262',
          size: 3,
        });
      },
    });
  });
  await menu(page, 'clear-annotations');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritch.docState().doc.objects.map((o: any) => o.type)))
    .toEqual(['image', 'image']);
  await menu(page, 'undo');
  await expect
    .poll(() => page.evaluate(() => (window as any).__skritch.docState().doc.objects.at(-1).type))
    .toBe('arrow');
  await menu(page, 'prefs');
  await expect(page.getByRole('dialog', { name: /Preferences/ })).toBeVisible();
});

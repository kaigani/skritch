import { expect, test } from '@playwright/test';

test('crop targets images, exports the source crop, and switches to canvas on a backdrop click', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('skritch:prefs', JSON.stringify({ firstRunTipDismissed: true })),
  );
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__skritch);
  await page.evaluate(async () => {
    const h = (window as any).__skritch;
    const { newBlank } = await import('/src/actions/image.ts');
    await newBlank();
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 100;
    const g = c.getContext('2d')!;
    g.fillStyle = 'red';
    g.fillRect(0, 0, 100, 100);
    g.fillStyle = 'blue';
    g.fillRect(100, 0, 100, 100);
    const bytes = new Uint8Array(await (await fetch(c.toDataURL())).arrayBuffer());
    const d = h.docState().doc;
    await h.docState().open({
      ...d,
      assets: { asset: { id: 'asset', mime: 'image/png', width: 200, height: 100, bytes } },
      objects: [
        { id: 'left', type: 'image', assetId: 'asset', x: 100, y: 100, w: 200, h: 100, opacity: 1 },
        { id: 'right', type: 'image', assetId: 'asset', x: 400, y: 100, w: 200, h: 100, opacity: 1 },
      ],
    });
    h.docState().select(['left']);
  });
  await page.locator('[data-tool=crop]').click();
  await expect(page.getByTestId('crop-target')).toHaveText('Image');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('200');
  await page.getByLabel('Width', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const state = await page.evaluate(async () => {
    const h = (window as any).__skritch;
    const d = h.docState().doc;
    const bytes = await h.encodeDocument(d, 'png');
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return {
      canvas: d.canvas,
      objects: d.objects,
      inside: Array.from(g.getImageData(175, 125, 1, 1).data),
      removed: Array.from(g.getImageData(250, 125, 1, 1).data),
    };
  });
  expect(state.canvas).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  expect(state.objects[0]).toMatchObject({ w: 100, sourceRect: { x: 0, y: 0, w: 100, h: 100 } });
  expect(state.objects[1]).toMatchObject({ x: 400, w: 200 });
  expect(state.inside).toEqual([255, 0, 0, 255]);
  expect(state.removed).toEqual([255, 255, 255, 255]);
  await page.evaluate(() => (window as any).__skritch.docState().undo());
  await page.locator('[data-tool=crop]').click();
  const b = (await page.getByTestId('canvas').boundingBox())!;
  // At 100%, the 800×600 canvas is centered inside the stage.
  const zoom = parseInt((await page.getByTestId('zoom-pct').innerText()).replace('%', '')) / 100;
  const x = b.x + (b.width - 800 * zoom) / 2;
  const y = b.y + (b.height - 600 * zoom) / 2;
  await page.mouse.click(x + 500 * zoom, y + 150 * zoom);
  await expect
    .poll(() => page.evaluate(async () => (await import('/src/state/ui.ts')).ui().crop?.targetId))
    .toBe('right');
  await page.mouse.click(b.x + 5, b.y + 5);
  await expect(page.getByTestId('crop-target')).toHaveText('Canvas');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('800');
  await page.getByLabel('Width', { exact: true }).fill('450');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const after = await page.evaluate(() => (window as any).__skritch.docState().doc);
  expect(after.canvas.w).toBe(450);
  expect(after.objects.map((o: any) => o.w)).toEqual([200, 50]);
  expect(after.objects[1]).toMatchObject({ sourceRect: { x: 0, y: 0, w: 50, h: 100 } });
  // The selection frame and hit testing use these bounds: neither can overhang the canvas.
  await page.evaluate(() => (window as any).__skritch.docState().select(['right']));
  const bounds = await page.evaluate(async () => {
    const { boundsOf } = await import('/src/model/commands/document.ts');
    const s = (window as any).__skritch.docState();
    return boundsOf(s.doc, s.selection);
  });
  expect(bounds).toEqual({ x: 400, y: 100, w: 50, h: 100 });
  await page.evaluate(() => (window as any).__skritch.docState().undo());
  const undone = await page.evaluate(() => (window as any).__skritch.docState().doc);
  expect(undone.canvas.w).toBe(800);
  expect(undone.objects.map((o: any) => o.w)).toEqual([200, 200]);
});

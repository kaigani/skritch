import { describe, expect, it } from 'vitest';
import { defaultFileStem, safeFileStem } from '../../src/export/formats';
import { History } from '../../src/model/commands/history';
import { newDocument, renameDocument } from '../../src/model/commands/document';

describe('filenames', () => {
  it('prefixes a window title with local ddmmyy:hhmmss, with zero padding', () => {
    expect(defaultFileStem(new Date(2026, 8, 29, 8, 23, 10), 'The Lantern Road — Real Frenemies')).toBe(
      '290926:082310_The Lantern Road — Real Frenemies',
    );
    expect(defaultFileStem(new Date(2004, 0, 2, 3, 4, 5), '  ')).toBe('020104:030405_Screenshot');
  });
  it('preserves the requested colon on Mac while excluding path components and control characters', () => {
    expect(safeFileStem('290926:082310_Report / Draft\\Review\u0000', 'mac')).toBe(
      '290926:082310_Report _ Draft_Review_',
    );
    expect(safeFileStem('290926:082310_Report', 'windows')).toBe('290926_082310_Report');
    expect(new TextEncoder().encode(safeFileStem('🌙'.repeat(100))).length).toBe(240);
    expect(safeFileStem('..')).toBe('');
    expect(safeFileStem('   ')).toBe('');
  });
  it('renames undoably without changing the original capture timestamp', () => {
    const doc = newDocument({ canvas: { x: 0, y: 0, w: 100, h: 100 } });
    const h = new History(doc);
    h.execute(renameDocument('My chosen filename'));
    expect(h.state.meta.title).toBe('My chosen filename');
    expect(h.state.meta.createdAt).toBe(doc.meta.createdAt);
    h.undo();
    expect(h.state.meta.title).toBe(doc.meta.title);
    h.redo();
    expect(h.state.meta.title).toBe('My chosen filename');
  });
});

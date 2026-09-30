export const isMac =
  typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);

/** Platform shortcut label, e.g. kb('S', { shift: true }) → "⇧⌘S" / "Ctrl+Shift+S". */
export function kb(key: string, o: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}): string {
  if (isMac) return `${o.ctrl ? '⌃' : ''}${o.alt ? '⌥' : ''}${o.shift ? '⇧' : ''}${o.ctrl ? '' : '⌘'}${key}`;
  return `Ctrl+${o.shift ? 'Shift+' : ''}${o.alt ? 'Alt+' : ''}${key}`;
}

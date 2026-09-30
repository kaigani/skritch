import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'side' | 'below' | 'above';

/** Anchored popover that closes on outside press or Esc. */
export function Popover({
  anchor,
  placement,
  onClose,
  children,
  className = 'popover',
  align = 'start',
}: {
  anchor: HTMLElement | null;
  placement: Placement;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const me = ref.current.getBoundingClientRect();
    let left: number;
    let top: number;
    let arrow: number;
    if (placement === 'side') {
      left = a.right + 10;
      top = Math.max(8, Math.min(window.innerHeight - me.height - 8, a.top + a.height / 2 - 22));
      arrow = a.top + a.height / 2 - top - 6;
    } else {
      left = align === 'end' ? a.right - me.width : a.left - 6;
      left = Math.max(8, Math.min(window.innerWidth - me.width - 8, left));
      top = placement === 'below' ? a.bottom + 9 : a.top - me.height - 9;
      arrow = a.left + a.width / 2 - left - 6;
    }
    setPos({ left, top, arrow });
  }, [anchor, placement, align]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`${className} ${className === 'popover' ? placement : ''}`}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        ['--arrow-top' as string]: `${pos?.arrow ?? 16}px`,
        ['--arrow-left' as string]: `${pos?.arrow ?? 20}px`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Menu item row. */
export function MenuItem({
  label,
  kbd,
  onClick,
  disabled,
  checked,
}: {
  label: string;
  kbd?: string;
  onClick: () => void;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
    >
      {checked !== undefined && (
        <span className="menu-check" aria-hidden>
          {checked ? '✓' : ''}
        </span>
      )}
      <span>{label}</span>
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

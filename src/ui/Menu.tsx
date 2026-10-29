import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A "⋯" button with a small menu (UI direction B): the header's less-used actions, and a
 * Library card's actions. Closes on a click elsewhere, Escape, or choosing an item.
 */
export function Menu({ label, children, className = '' }: { label: string; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className={`menu-box ${className}`} ref={box}>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label}>
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}

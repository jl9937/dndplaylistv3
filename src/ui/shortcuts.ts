import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  openPalette: () => void;
  /** 1-based tile number. */
  playTile: (n: number) => void;
}

// Tag names, not instanceof: elements in the floating window come from another realm.
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type);
}

/** US-2a-5: Cmd/Ctrl+K or / for the palette, 1–9 for tiles. Space does nothing (D23). */
export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean, extraWindow: Window | null = null): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current.openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        ref.current.openPalette();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        ref.current.playTile(Number(e.key));
      } else if (e.key === ' ') {
        // A stray Space must not re-press the tile that has focus (a button's default action).
        e.preventDefault();
      }
    };
    // Buttons activate on Space *keyup*, so block that too. Enter still activates them.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
    };
    const targets = extraWindow ? [window, extraWindow] : [window];
    for (const w of targets) {
      w.addEventListener('keydown', onKeyDown);
      w.addEventListener('keyup', onKeyUp);
    }
    return () => {
      for (const w of targets) {
        w.removeEventListener('keydown', onKeyDown);
        w.removeEventListener('keyup', onKeyUp);
      }
    };
  }, [enabled, extraWindow]);
}

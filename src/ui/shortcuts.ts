import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  openPalette: () => void;
  /** 1-based tile number. */
  playTile: (n: number) => void;
  togglePause: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(target.type);
}

/** US-2a-5: Cmd/Ctrl+K or / for the palette, 1–9 for tiles, Space to pause/resume. */
export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
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
        e.preventDefault();
        ref.current.togglePause();
      }
    };
    // A focused button activates on Space *keyup*: stop it, or Space would also re-press the last tile.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);
}

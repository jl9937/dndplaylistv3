// Compact mode (D12, spec §13.5): (A) dock the installed app window to the right edge;
// (B) float the strip in an always-on-top Document Picture-in-Picture window.

import { log } from '../diagnostics/log';

export const STRIP_WIDTH = 360;
export const FLOAT_HEIGHT = 640;

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/** Only an installed app window may resize and move itself. A tab only changes layout. */
export function isInstalledWindow(): boolean {
  return ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

let saved: { w: number; h: number; x: number; y: number } | null = null;

/** Resize to a full-height strip at the right edge. Returns false if the browser refused. */
export function dockToRight(): boolean {
  if (!isInstalledWindow()) return false;
  saved = { w: outerWidth, h: outerHeight, x: screenX, y: screenY };
  const s = screen as Screen & { availLeft?: number; availTop?: number };
  try {
    resizeTo(STRIP_WIDTH, s.availHeight);
    moveTo((s.availLeft ?? 0) + s.availWidth - STRIP_WIDTH, s.availTop ?? 0);
    log('app', 'compact: window docked to the right edge');
    return true;
  } catch (e) {
    log('app', `compact: resize refused (${e instanceof Error ? e.message : e})`);
    return false;
  }
}

export function restoreWindow(): void {
  if (!saved) return;
  try {
    resizeTo(saved.w, saved.h);
    moveTo(saved.x, saved.y);
  } catch {
    /* the user may have closed or moved things; layout still restores */
  }
  saved = null;
}

export const canFloat = (): boolean => typeof window !== 'undefined' && !!window.documentPictureInPicture;

/** Open the always-on-top window and give it the app's styles. Must be called from a click. */
export async function openFloat(): Promise<Window> {
  const pip = await window.documentPictureInPicture!.requestWindow({ width: STRIP_WIDTH, height: FLOAT_HEIGHT });
  // Copy stylesheets: <link> in production (allowed by style-src 'self'), <style> in dev.
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    pip.document.head.appendChild(node.cloneNode(true));
  }
  pip.document.title = 'D&D Playlist Manager';
  pip.document.body.className = 'pip-body';
  log('app', 'float: opened always-on-top strip');
  return pip;
}

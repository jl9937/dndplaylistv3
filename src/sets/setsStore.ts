// Persistence for the Board (`sets.v1`), in this browser's localStorage only: nothing is
// stored on a server. Survives logout; validated on load. The document keeps a `sets`
// array (always one set since D23) so the stored format never needs migrating.

import { log } from '../diagnostics/log';
import { read, write } from '../storage';
import { parseDoc } from './validate';
import { emptyDoc, type SetsDoc } from './sets';

const KEY = 'sets.v1';
const PERSIST_KEY = 'prefs.persistRequested';

function load(): SetsDoc {
  const raw = read<unknown>(KEY);
  if (raw === null) return emptyDoc();
  const parsed = parseDoc(raw);
  if (parsed.ok) return parsed.doc;
  log('app', `stored session sets were unreadable (${parsed.error}); starting fresh`);
  return emptyDoc();
}

let doc: SetsDoc = load();
const listeners = new Set<() => void>();

/** Ask the browser not to evict our storage. Once, on the first save. */
function requestPersistence() {
  if (read<boolean>(PERSIST_KEY)) return;
  write(PERSIST_KEY, true);
  void navigator.storage?.persist?.().then((granted) => log('app', `persistent storage ${granted ? 'granted' : 'not granted'}`));
}

export function getSets(): SetsDoc {
  return doc;
}

export function updateSets(fn: (d: SetsDoc) => SetsDoc): void {
  const next = fn(doc);
  if (next === doc) return;
  doc = next;
  write(KEY, doc);
  requestPersistence();
  listeners.forEach((l) => l());
}

export function subscribeSets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  // Another window changed the sets.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    doc = load();
    listeners.forEach((l) => l());
  });
}

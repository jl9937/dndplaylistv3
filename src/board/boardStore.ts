// Persistence for the Board, in this browser's localStorage only: nothing is stored on a
// server. Survives logout; validated on load; migrated from v1 once.

import { log } from '../diagnostics/log';
import { read, remove, write } from '../storage';
import { emptyBoard, type BoardDoc } from './board';
import { migrateV1, parseBoard } from './validate';

const KEY = 'sets.board';
const V1_KEY = 'sets.v1';
const PERSIST_KEY = 'prefs.persistRequested';

function load(): BoardDoc {
  const raw = read<unknown>(KEY);
  if (raw !== null) {
    const parsed = parseBoard(raw);
    if (parsed.ok) return parsed.board;
    log('app', `stored Board was unreadable (${parsed.error}); starting empty`);
    return emptyBoard();
  }
  const v1 = read<unknown>(V1_KEY);
  if (v1 === null) return emptyBoard();
  const migrated = migrateV1(v1);
  if (!migrated.ok) {
    log('app', `old session sets were unreadable (${migrated.error}); starting empty`);
    return emptyBoard();
  }
  write(KEY, migrated.board);
  remove(V1_KEY);
  log('app', `Board migrated from v1 (${migrated.board.scenes.length} tiles)`);
  return migrated.board;
}

let board: BoardDoc = load();
const listeners = new Set<() => void>();

/** Ask the browser not to evict our storage. Once, on the first save. */
function requestPersistence() {
  if (read<boolean>(PERSIST_KEY)) return;
  write(PERSIST_KEY, true);
  void navigator.storage?.persist?.().then((granted) => log('app', `persistent storage ${granted ? 'granted' : 'not granted'}`));
}

export const getBoard = (): BoardDoc => board;

export function updateBoard(fn: (b: BoardDoc) => BoardDoc): void {
  const next = fn(board);
  if (next === board) return;
  board = next;
  write(KEY, board);
  requestPersistence();
  listeners.forEach((l) => l());
}

export function subscribeBoard(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: re-read storage, as on a fresh page load. */
export function reloadBoardForTests(): void {
  board = load();
}

if (typeof window !== 'undefined') {
  // Another window changed the Board.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    board = load();
    listeners.forEach((l) => l());
  });
}

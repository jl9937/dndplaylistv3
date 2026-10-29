// The playlist library: fetched at login, cached in localStorage so the Board and the
// palette are usable at once on the next load (spec §13.2). Refreshed in the background.

import { log } from '../diagnostics/log';
import { getMe, getMyPlaylists } from '../spotify/api';
import { pickCover, type Playlist } from '../spotify/types';
import { read, write } from '../storage';

export type LibraryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      playlists: Playlist[];
      byId: Map<string, Playlist>;
      myId: string;
      fetchedAt: number;
      /** The last background refresh failed; showing the cached list. */
      refreshError: string | null;
    };

interface Cached {
  at: number;
  myId: string;
  playlists: Playlist[];
}

const CACHE_KEY = 'cache.library';

/** Keep only what the UI needs, and one image, so the cache stays small. */
function slim(p: Playlist): Playlist {
  const cover = pickCover(p.images);
  const images = cover ? [cover] : null;
  const total = p.items?.total ?? p.tracks?.total;
  return {
    id: p.id,
    name: p.name,
    uri: p.uri,
    images,
    owner: { id: p.owner.id, display_name: p.owner.display_name ?? null },
    items: total === undefined ? null : { total },
  };
}

let state: LibraryState = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: LibraryState) {
  state = next;
  listeners.forEach((fn) => fn());
}

function ok(playlists: Playlist[], myId: string, fetchedAt: number, refreshError: string | null) {
  set({
    status: 'ok',
    playlists,
    byId: new Map(playlists.map((p) => [p.id, p])),
    myId,
    fetchedAt,
    refreshError,
  });
}

/** Show the cache at once (if any), then fetch fresh data. */
export async function loadLibrary(): Promise<void> {
  const cached = read<Cached>(CACHE_KEY);
  if (cached?.playlists?.length) {
    ok(cached.playlists, cached.myId, cached.at, null);
  } else {
    set({ status: 'loading' });
  }
  try {
    const [me, playlists] = await Promise.all([getMe(), getMyPlaylists()]);
    const slimmed = playlists.map(slim);
    const at = Date.now();
    write(CACHE_KEY, { at, myId: me.id, playlists: slimmed } satisfies Cached);
    ok(slimmed, me.id, at, null);
    log('app', `library loaded: ${playlists.length} playlists`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (state.status === 'ok') ok(state.playlists, state.myId, state.fetchedAt, message);
    else set({ status: 'error', message });
  }
}

/** Show a rename at once (and keep it in the cache), without waiting for a refresh. */
export function renameLocally(playlistId: string, name: string): void {
  if (state.status !== 'ok') return;
  const playlists = state.playlists.map((p) => (p.id === playlistId ? { ...p, name } : p));
  write(CACHE_KEY, { at: state.fetchedAt, myId: state.myId, playlists } satisfies Cached);
  ok(playlists, state.myId, state.fetchedAt, state.refreshError);
}

export function resetLibrary(): void {
  set({ status: 'loading' });
}

export const getLibrary = () => state;

export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

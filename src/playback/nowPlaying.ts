// What Spotify is actually doing (D21): polled every 5 s while the window is visible,
// never while hidden. Also corrects the tiles when playback changes outside this app.

import { log } from '../diagnostics/log';
import { getPlaybackState } from '../spotify/api';
import type { PlaybackState } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';
import { pipeline, type PressState } from './pipeline';

export const POLL_MS = 5_000;

export interface NowPlaying {
  /** null: nothing active (204). undefined: not fetched yet. */
  state: PlaybackState | null | undefined;
  at: number | null;
  error: string | null;
  /** When the last press, pause or resume settled. Observations older than this are stale. */
  pressSettledAt: number | null;
}

const initial: NowPlaying = { state: undefined, at: null, error: null, pressSettledAt: null };
let snap: NowPlaying = initial;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let inflight = false;

function set(next: Partial<NowPlaying>) {
  snap = { ...snap, ...next };
  listeners.forEach((fn) => fn());
}

export async function refreshNowPlaying(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const state = await getPlaybackState({ signal: AbortSignal.timeout(POLL_MS) });
    set({ state, at: Date.now(), error: null });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (error !== snap.error) log('app', `now playing: ${error}`);
    set({ error });
  } finally {
    inflight = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!running || document.visibilityState !== 'visible') return;
  timer = setTimeout(async () => {
    await refreshNowPlaying();
    schedule();
  }, POLL_MS);
}

function onVisibility() {
  if (document.visibilityState === 'visible') void refreshNowPlaying().then(schedule);
  else schedule(); // clears the timer
}

let lastStatus: PressState['status'] = 'idle';
function onPress() {
  const status = pipeline.getState().status;
  // A press just settled: show its result straight away rather than up to 5 s later.
  if (status !== lastStatus && (status === 'playing' || status === 'paused')) {
    set({ pressSettledAt: Date.now() });
    void refreshNowPlaying();
  }
  lastStatus = status;
}

export function startNowPlaying(): () => void {
  running = true;
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = pipeline.subscribe(onPress);
  void refreshNowPlaying().then(schedule);
  return () => {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribe();
    snap = initial;
  };
}

export const getNowPlaying = () => snap;

export function subscribeNowPlaying(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type TileStatus = 'idle' | 'starting' | 'playing' | 'paused' | 'failed';

/**
 * The status to show for a playlist, from the last press corrected by what Spotify is
 * observed doing *after* that press settled. A tile never says Playing for music that
 * has since changed in the Spotify app.
 */
export function displayStatus(playlistId: string, press: PressState, now: NowPlaying): TileStatus {
  if (press.status === 'idle' || press.playlistId !== playlistId) return 'idle';
  if (press.status !== 'playing' && press.status !== 'paused') return press.status;
  const fresh = now.at !== null && now.pressSettledAt !== null && now.at > now.pressSettledAt;
  if (!fresh || now.state === undefined) return press.status;
  const observedId = parsePlaylistId(now.state?.context?.uri);
  if (observedId !== playlistId) return 'idle';
  return now.state?.is_playing ? 'playing' : 'paused';
}

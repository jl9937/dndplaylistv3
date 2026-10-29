// The Studio's outlier scan (US-5-2): reads my tagged playlists' tracks, gets their features
// (cached), and finds outliers. Kept outside React, so the results survive switching tabs.

import { log } from '../diagnostics/log';
import { isListed } from '../library/tags';
import { getPlaylistTracks } from '../spotify/api';
import type { Playlist, Track } from '../spotify/types';
import { findOutliers, MIN_FOR_OUTLIERS, type PlaylistInput, type PlaylistOutliers } from './outliers';
import { featuresFor } from './featureCache';
import type { Features } from './reccobeats';

export type ScanState =
  | { phase: 'idle' }
  | { phase: 'tracks'; done: number; of: number }
  | { phase: 'features'; done: number; of: number }
  | {
      phase: 'done';
      at: number;
      /** Every scanned playlist, outliers included. */
      playlists: PlaylistOutliers[];
      /** Playlists with too few tracks with features to judge. */
      tooShort: number;
      failed: string[];
      /** What was scanned, kept for recommendations (US-5-3). */
      inputs: PlaylistInput[];
      features: Map<string, Features>;
    }
  | { phase: 'error'; message: string };

interface Deps {
  getTracks?: (playlistId: string, opts: { signal: AbortSignal }) => Promise<Track[]>;
  features?: typeof featuresFor;
}

let state: ScanState = { phase: 'idle' };
let abort: AbortController | null = null;
const listeners = new Set<() => void>();
const set = (s: ScanState) => {
  state = s;
  listeners.forEach((fn) => fn());
};

/** The playlists a scan covers: my own tagged ones (Spotify only lists tracks of my own). */
export const scannable = (playlists: Playlist[], myId: string) => playlists.filter((p) => p.owner.id === myId && isListed(p.name, false));

export async function scan(playlists: Playlist[], deps: Deps = {}): Promise<void> {
  abort?.abort();
  const ac = new AbortController();
  abort = ac;
  const current = () => abort === ac;
  const inputs: PlaylistInput[] = [];
  const failed: string[] = [];
  try {
    for (const [i, p] of playlists.entries()) {
      if (current()) set({ phase: 'tracks', done: i, of: playlists.length });
      try {
        inputs.push({ id: p.id, name: p.name, tracks: await (deps.getTracks ?? getPlaylistTracks)(p.id, { signal: ac.signal }) });
      } catch (e) {
        if (ac.signal.aborted) throw e;
        failed.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const ids = inputs.flatMap((p) => p.tracks.map((t) => t.id));
    const features = await (deps.features ?? featuresFor)(ids, {
      signal: ac.signal,
      onProgress: (done, of) => current() && set({ phase: 'features', done, of }),
    });
    const report = findOutliers(inputs, features);
    const outliers = report.reduce((a, p) => a + p.outliers.length, 0);
    log('app', `outlier scan: ${inputs.length} playlists, ${outliers} suggestions`);
    if (current())
      set({
        phase: 'done',
        at: Date.now(),
        playlists: report,
        tooShort: report.filter((p) => p.found < MIN_FOR_OUTLIERS).length,
        failed,
        inputs,
        features,
      });
  } catch (e) {
    if (!current()) return;
    set(ac.signal.aborted ? { phase: 'idle' } : { phase: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

export function stopScan(): void {
  abort?.abort();
  abort = null;
  set({ phase: 'idle' });
}

export const getScan = () => state;

export function subscribeScan(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

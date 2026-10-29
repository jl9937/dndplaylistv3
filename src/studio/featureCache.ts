// Audio features kept in localStorage (`cache.features`), so a re-scan only asks ReccoBeats
// about new tracks. A track's features never change. Tracks ReccoBeats didn't know are
// asked about again after a month, in case it has added them.

import { read, write } from '../storage';
import { fetchFeatures, type Features } from './reccobeats';

const KEY = 'cache.features';
export const RECHECK_MISSING_MS = 30 * 24 * 3_600_000;

interface Stored {
  v: 1;
  found: Record<string, Features>;
  /** Spotify ID → when ReccoBeats last didn't know it. */
  missing: Record<string, number>;
}

interface Deps {
  fetch?: typeof fetchFeatures;
  now?: () => number;
  signal?: AbortSignal;
  /** Looked-up count so far, of the tracks that weren't cached. */
  onProgress?: (done: number, of: number) => void;
}

export async function featuresFor(ids: string[], deps: Deps = {}): Promise<Map<string, Features>> {
  const now = (deps.now ?? Date.now)();
  const stored = read<Stored>(KEY);
  const cache: Stored = stored?.v === 1 ? stored : { v: 1, found: {}, missing: {} };
  const unique = [...new Set(ids)];
  const wanted = unique.filter((id) => !cache.found[id] && !(now - (cache.missing[id] ?? -Infinity) < RECHECK_MISSING_MS));

  if (wanted.length > 0) {
    const got = await (deps.fetch ?? fetchFeatures)(wanted, {
      signal: deps.signal,
      onProgress: (done) => deps.onProgress?.(done, wanted.length),
    });
    for (const id of wanted) {
      const f = got.get(id);
      if (f) {
        cache.found[id] = f;
        delete cache.missing[id];
      } else cache.missing[id] = now;
    }
    try {
      write(KEY, cache);
    } catch {
      // Storage full: the features still work for this scan, just aren't kept.
    }
  }
  return new Map(unique.filter((id) => cache.found[id]).map((id) => [id, cache.found[id]]));
}

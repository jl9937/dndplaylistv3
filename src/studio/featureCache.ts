// Audio features kept in localStorage (`cache.features`), so a re-scan only asks ReccoBeats
// about new tracks. A track's features never change. Tracks ReccoBeats didn't know are
// asked about again after a month, in case it has added them.
//
// It shares the origin's ~5 MB with the login, so it's compact (rounded numbers in a fixed
// order, about 70 characters a track) and capped, oldest first.

import { read, write } from '../storage';
import { FEATURE_KEYS, fetchFeatures, type Features } from './reccobeats';

const KEY = 'cache.features';
export const RECHECK_MISSING_MS = 30 * 24 * 3_600_000;
/** At most this many tracks with features, and this many unknown ones. */
export const MAX_FOUND = 15_000;
export const MAX_MISSING = 5_000;

interface Stored {
  v: 2;
  /** Spotify ID → feature values in FEATURE_KEYS order. */
  found: Record<string, number[]>;
  /** Spotify ID → when ReccoBeats last didn't know it. */
  missing: Record<string, number>;
}

const pack = (f: Features) => FEATURE_KEYS.map((k) => Math.round(f[k] * 1000) / 1000);
const unpack = (v: number[]): Features | null =>
  Array.isArray(v) && v.length === FEATURE_KEYS.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, v[i]])) as unknown as Features)
    : null;

/** Keep the newest `max` entries (object keys keep insertion order). */
function trim<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.length <= max) return record;
  return Object.fromEntries(keys.slice(keys.length - max).map((k) => [k, record[k]]));
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
  // An older format is simply dropped: the next scan fetches it again.
  const cache: Stored = stored?.v === 2 ? stored : { v: 2, found: {}, missing: {} };
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
        cache.found[id] = pack(f);
        delete cache.missing[id];
      } else cache.missing[id] = now;
    }
    try {
      write(KEY, { v: 2, found: trim(cache.found, MAX_FOUND), missing: trim(cache.missing, MAX_MISSING) } satisfies Stored);
    } catch {
      // Storage full: the features still work for this scan, just aren't kept.
    }
  }
  const out = new Map<string, Features>();
  for (const id of unique) {
    const f = cache.found[id] && unpack(cache.found[id]);
    if (f) out.set(id, f);
  }
  return out;
}

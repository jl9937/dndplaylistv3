// ReccoBeats audio features (spec §13.4, research.md §7.2): free, no key, and it allows calls
// from our origin. Spotify-style values, looked up by Spotify track ID, up to 40 per call.
// Tracks it doesn't know are simply missing from the response.

import { sleep as realSleep } from '../sleep';

export const RECCOBEATS = 'https://api.reccobeats.com/v1/audio-features';
export const BATCH = 40;
/** Longest 429 wait we sit through, and how many times. */
const MAX_WAIT_SEC = 30;
const MAX_RETRIES = 3;

export interface Features {
  tempo: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
  speechiness: number;
  liveness: number;
  key: number;
  mode: number;
}

export const FEATURE_KEYS = [
  'tempo',
  'energy',
  'valence',
  'danceability',
  'acousticness',
  'instrumentalness',
  'loudness',
  'speechiness',
  'liveness',
  'key',
  'mode',
] as const satisfies readonly (keyof Features)[];

interface Deps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Called after each batch with how many IDs have been looked up so far. */
  onProgress?: (done: number) => void;
}

/** `https://open.spotify.com/track/ID` → ID. */
export function spotifyIdOf(href: unknown): string | null {
  const m = typeof href === 'string' ? /open\.spotify\.com\/track\/([A-Za-z0-9]{22})/.exec(href) : null;
  return m ? m[1] : null;
}

function parse(raw: unknown): Features | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = {} as Features;
  for (const k of FEATURE_KEYS) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) return null;
    out[k] = r[k];
  }
  return out;
}

/** Features for each ID ReccoBeats knows. IDs it doesn't know are absent from the map. */
export async function fetchFeatures(ids: string[], deps: Deps = {}): Promise<Map<string, Features>> {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.sleep ?? realSleep;
  const unique = [...new Set(ids)];
  const found = new Map<string, Features>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const url = `${RECCOBEATS}?ids=${batch.join(',')}`;
    for (let attempt = 0; ; attempt++) {
      deps.signal?.throwIfAborted();
      const res = await doFetch(url, { signal: deps.signal });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const sec = Number(res.headers.get('Retry-After')) || 2;
        if (sec > MAX_WAIT_SEC) throw new Error(`ReccoBeats is rate-limiting for ${sec} s`);
        await wait(sec * 1000, deps.signal);
        continue;
      }
      if (!res.ok) throw new Error(`ReccoBeats: HTTP ${res.status}`);
      const body = (await res.json()) as { content?: unknown[] };
      for (const raw of body.content ?? []) {
        const id = spotifyIdOf((raw as { href?: unknown })?.href);
        const f = parse(raw);
        if (id && f && batch.includes(id)) found.set(id, f);
      }
      break;
    }
    deps.onProgress?.(Math.min(i + BATCH, unique.length));
  }
  return found;
}

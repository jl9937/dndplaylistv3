// Which playlists a track belongs in (US-5-3, D32): mainly shared composer (artist) and album,
// with how it sounds (ReccoBeats features) as a weaker signal. `evaluate` measures it on my
// own library: each track is treated as new (all its memberships hidden) and we check whether
// one of its real playlists comes out on top.

import type { Track } from '../spotify/types';
import { DISTANCE_KEYS, known, type PlaylistInput } from './outliers';
import type { Features } from './reccobeats';

export interface Weights {
  artist: number;
  album: number;
  sound: number;
  /** Bigger playlists first: a baseline to beat, not a real signal. */
  size?: number;
}

interface Indexed {
  id: string;
  name: string;
  size: number;
  ids: Set<string>;
  artists: Map<string, number>;
  albums: Map<string, number>;
  /** Sum and count of z-scored feature vectors, for the sound centre. */
  sum: number[];
  n: number;
}

export interface Index {
  playlists: Indexed[];
  /** A track's z-scored features, or undefined without features. Works for tracks outside the index too. */
  vecOf: (trackId: string) => number[] | undefined;
  artistNames: Map<string, string>;
  maxSize: number;
}

export interface Suggestion {
  playlistId: string;
  name: string;
  score: number;
  /** Plain words, e.g. "3 tracks by Jesper Kyd", "same album as 2", "sounds alike". */
  reasons: string[];
}

/** Below this many tracks with features, a playlist has no meaningful sound centre. */
const MIN_FOR_SOUND = 3;
/** Smoothing: a 2-track playlist sharing one composer isn't a stronger match than a 40-track one sharing 15. */
const SMOOTH = 4;

export function buildIndex(playlists: PlaylistInput[], features: Map<string, Features>): Index {
  const all = new Map<string, Track>();
  for (const p of playlists) for (const t of p.tracks) all.set(t.id, t);
  const found = [...all.keys()].filter((id) => features.has(id)).map((id) => features.get(id)!);
  const stats = DISTANCE_KEYS.map((k) => {
    const xs = found.filter((f) => known(f, k)).map((f) => f[k]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  });
  // An unknown value sits at the library mean (z = 0).
  const vecOf = (id: string) => {
    const f = features.get(id);
    return f && DISTANCE_KEYS.map((k, i) => (known(f, k) ? (f[k] - stats[i].mean) / stats[i].sd : 0));
  };

  const artistNames = new Map<string, string>();
  const indexed = playlists.map((p): Indexed => {
    const artists = new Map<string, number>();
    const albums = new Map<string, number>();
    const sum = DISTANCE_KEYS.map(() => 0);
    let n = 0;
    for (const t of p.tracks) {
      const names = t.artists.split(', ');
      (t.artistKeys ?? []).forEach((a, i) => {
        artists.set(a, (artists.get(a) ?? 0) + 1);
        if (names[i]) artistNames.set(a, names[i]);
      });
      if (t.album) albums.set(t.album, (albums.get(t.album) ?? 0) + 1);
      const v = vecOf(t.id);
      if (v) {
        v.forEach((x, i) => (sum[i] += x));
        n++;
      }
    }
    return { id: p.id, name: p.name, size: p.tracks.length, ids: new Set(p.tracks.map((t) => t.id)), artists, albums, sum, n };
  });
  return { playlists: indexed, vecOf, artistNames, maxSize: Math.max(1, ...indexed.map((p) => p.size)) };
}

/**
 * Playlists for a track, best first. Playlists it's already in are left out, unless
 * `leaveOut` is set: then they count as if the track weren't in them (for evaluation).
 */
export function suggest(track: Track, index: Index, weights: Weights, leaveOut = false): Suggestion[] {
  const keys = track.artistKeys ?? [];
  const v = index.vecOf(track.id);
  const out: Suggestion[] = [];
  for (const p of index.playlists) {
    const self = p.ids.has(track.id) ? 1 : 0;
    if (self && !leaveOut) continue;
    const size = p.size - self;
    if (size <= 0) continue;

    let byArtist = 0;
    let topArtist: string | null = null;
    let topCount = 0;
    for (const a of keys) {
      const c = (p.artists.get(a) ?? 0) - self;
      byArtist += c;
      if (c > topCount) [topArtist, topCount] = [a, c];
    }
    const byAlbum = track.album ? (p.albums.get(track.album) ?? 0) - self : 0;

    let sound = 0;
    const selfV = self && v ? 1 : 0;
    if (v && p.n - selfV >= MIN_FOR_SOUND) {
      const centre = p.sum.map((s, i) => (s - selfV * v[i]) / (p.n - selfV));
      const d2 = v.reduce((a, x, i) => a + (x - centre[i]) ** 2, 0);
      sound = Math.exp(-d2 / 8); // ~0.9 at 1 z-unit, ~0.4 at a typical 2.6, ~0.1 at 4
    }

    const score =
      weights.artist * (byArtist / (size + SMOOTH)) +
      weights.album * (byAlbum / (size + SMOOTH)) +
      weights.sound * sound +
      (weights.size ?? 0) * (size / index.maxSize);
    const reasons: string[] = [];
    if (topArtist && topCount > 0) reasons.push(`${topCount} ${topCount === 1 ? 'track' : 'tracks'} by ${index.artistNames.get(topArtist) ?? 'the same artist'}`);
    if (byAlbum > 0) reasons.push(`${byAlbum} from the same album`);
    if (sound >= 0.6) reasons.push('sounds alike');
    out.push({ playlistId: p.id, name: p.name, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export interface EvalRow {
  label: string;
  /** Tracks tested: those in at least one scanned playlist. */
  tracks: number;
  hit1: number;
  hit3: number;
  hit5: number;
}

/** Chosen from Jim's measurement (2026-10-29): top 3 49%, top 5 57%, against 13% and 19% for the biggest playlists. */
export const SORTER_WEIGHTS: Weights = { artist: 1, album: 1, sound: 0.05 };

export const COMBOS: { label: string; weights: Weights }[] = [
  { label: 'Biggest playlists (baseline)', weights: { artist: 0, album: 0, sound: 0, size: 1 } },
  { label: 'Sound only', weights: { artist: 0, album: 0, sound: 1 } },
  { label: 'Composer only', weights: { artist: 1, album: 0, sound: 0 } },
  { label: 'Album only', weights: { artist: 0, album: 1, sound: 0 } },
  { label: 'Composer + album', weights: { artist: 1, album: 1, sound: 0 } },
  { label: 'Composer + album, sound breaks ties', weights: { artist: 1, album: 1, sound: 0.05 } },
  { label: 'Composer + album + some sound', weights: { artist: 1, album: 1, sound: 0.3 } },
  { label: 'Composer + album + sound equally', weights: { artist: 1, album: 1, sound: 1 } },
];

/** Treat each track as new and check whether one of its playlists comes out in the top 1, 3, 5. */
export function evaluate(playlists: PlaylistInput[], features: Map<string, Features>, combos = COMBOS): EvalRow[] {
  const index = buildIndex(playlists, features);
  const tracks = new Map<string, Track>();
  for (const p of playlists) for (const t of p.tracks) tracks.set(t.id, t);
  return combos.map(({ label, weights }) => {
    let hit1 = 0;
    let hit3 = 0;
    let hit5 = 0;
    for (const t of tracks.values()) {
      const ranked = suggest(t, index, weights, true);
      // A hit needs evidence: with nothing to go on, every score is 0 and the order is just A–Z.
      const at = ranked.findIndex((s) => s.score > 0 && index.playlists.find((p) => p.id === s.playlistId)!.ids.has(t.id));
      if (at === 0) hit1++;
      if (at >= 0 && at < 3) hit3++;
      if (at >= 0 && at < 5) hit5++;
    }
    return { label, tracks: tracks.size, hit1, hit3, hit5 };
  });
}

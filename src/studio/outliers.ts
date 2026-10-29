// Outliers (US-5-2, D32): tracks much further from their playlist's centre, in audio
// features, than the playlist's other tracks. Distances are in z-units over every scanned
// track, so a playlist is judged against the whole library's scale and its own spread.

import type { Track } from '../spotify/types';
import type { Features } from './reccobeats';

/** Features used for distances, z-scored across all found tracks. Key and mode are left out. */
export const DISTANCE_KEYS = [
  'energy',
  'valence',
  'danceability',
  'acousticness',
  'instrumentalness',
  'tempo',
  'loudness',
] as const satisfies readonly (keyof Features)[];

/** Playlists with fewer found tracks than this have no meaningful centre: no outliers. */
export const MIN_FOR_OUTLIERS = 8;
/**
 * A track is an outlier when its distance from the playlist's centre is this many robust
 * spreads (MAD) above the playlist's median distance. Relative to the playlist's own spread,
 * so a deliberately varied playlist flags less. (A fixed cut-off doesn't work: in 7
 * dimensions a typical track is already about 2.6 z-units from the centre.)
 */
export const OUTLIER_SPREADS = 3;
/** The smallest spread used, in z-units: in a playlist of near-identical tracks, a tiny difference isn't an outlier. */
export const MIN_SPREAD = 0.25;

/** Why a track was flagged: a feature where it differs most from its playlist. */
export interface OutlierReason {
  feature: (typeof DISTANCE_KEYS)[number];
  value: number;
  /** The playlist's median for this feature. */
  typical: number;
}

export interface Outlier {
  track: Track;
  distance: number;
  reasons: OutlierReason[];
}

export interface PlaylistInput {
  id: string;
  name: string;
  tracks: Track[];
}

export interface PlaylistOutliers {
  id: string;
  name: string;
  tracks: number;
  /** Tracks with features: below MIN_FOR_OUTLIERS, the playlist isn't judged. */
  found: number;
  outliers: Outlier[];
}

const median = (xs: number[]) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** ReccoBeats reports tempo 0 when it finds no beat (chant, drones): unknown, not slow (D32). */
export const known = (f: Features, k: keyof Features) => !(k === 'tempo' && f.tempo <= 0);

const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0));

export function findOutliers(playlists: PlaylistInput[], features: Map<string, Features>): PlaylistOutliers[] {
  const unique = new Map<string, Track>();
  for (const p of playlists) for (const t of p.tracks) unique.set(t.id, t);

  // z-score each distance feature over every found track, once each.
  const found = [...unique.keys()].filter((id) => features.has(id));
  const stats = DISTANCE_KEYS.map((k) => {
    const xs = found.map((id) => features.get(id)!).filter((f) => known(f, k)).map((f) => f[k]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  });
  const vec = (f: Features) => DISTANCE_KEYS.map((k, i) => (known(f, k) ? (f[k] - stats[i].mean) / stats[i].sd : NaN));

  const groups = playlists.map((p) => {
    const vecs = p.tracks.filter((t) => features.has(t.id)).map((t) => ({ track: t, v: vec(features.get(t.id)!) }));
    // An unknown value takes the playlist's own average, so it neither flags nor hides a track.
    DISTANCE_KEYS.forEach((_, i) => {
      const xs = vecs.map((x) => x.v[i]).filter((x) => !Number.isNaN(x));
      const fill = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      for (const x of vecs) if (Number.isNaN(x.v[i])) x.v[i] = fill;
    });
    const sum = DISTANCE_KEYS.map((_, i) => vecs.reduce((a, x) => a + x.v[i], 0));
    return { p, vecs, sum };
  });
  const centre = (sum: number[], n: number) => sum.map((x) => x / n);

  return groups.map(({ p, vecs, sum }) => {
    const fs = p.tracks.map((t) => features.get(t.id)).filter((f): f is Features => !!f);
    const med = (k: keyof Features) => median(fs.filter((f) => known(f, k)).map((f) => f[k]));
    const scored: { track: Track; v: number[]; own: number[]; d: number }[] = [];
    for (const { track, v } of vecs) {
      if (vecs.length < 2) continue;
      // Leave the track out of its own centre, or it always looks closest to home.
      const own = centre(
        sum.map((s, i) => s - v[i]),
        vecs.length - 1,
      );
      const d = dist(v, own);
      scored.push({ track, v, own, d });
    }
    const outliers: Outlier[] = [];
    if (scored.length >= MIN_FOR_OUTLIERS) {
      const ds = scored.map((x) => x.d);
      const mid = median(ds)!;
      const spread = Math.max(1.4826 * median(ds.map((d) => Math.abs(d - mid)))!, MIN_SPREAD);
      for (const x of scored) {
        if (x.d <= mid + OUTLIER_SPREADS * spread) continue;
        const reasons = DISTANCE_KEYS.map((feature, i) => ({ feature, gap: Math.abs(x.v[i] - x.own[i]) }))
          .sort((a, b) => b.gap - a.gap)
          .slice(0, 2)
          .map(({ feature }) => ({ feature, value: features.get(x.track.id)![feature], typical: med(feature)! }));
        outliers.push({ track: x.track, distance: x.d, reasons });
      }
    }
    outliers.sort((a, b) => b.distance - a.distance);
    return { id: p.id, name: p.name, tracks: p.tracks.length, found: fs.length, outliers };
  });
}

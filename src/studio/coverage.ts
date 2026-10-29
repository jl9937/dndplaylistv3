// The Milestone 5 spike's numbers: how many of Jim's tracks ReccoBeats knows, and whether
// its features tell his playlists apart well enough for outliers (D31 #2) and
// recommendations (D31 #3).

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

/** A track this far (in z-score units) from its playlist's centre counts as an outlier. */
export const OUTLIER_DISTANCE = 2.5;

export interface PlaylistInput {
  id: string;
  name: string;
  tracks: Track[];
}

export interface PlaylistCoverage {
  id: string;
  name: string;
  tracks: number;
  found: number;
  /** Medians of the found tracks, or null with none found. */
  median: Partial<Record<'tempo' | 'energy' | 'valence' | 'instrumentalness' | 'acousticness', number>>;
  /** Found tracks whose nearest playlist centre (leaving the track out of its own) is this one. */
  nearestOwn: number;
  outliers: { track: Track; distance: number }[];
}

export interface CoverageReport {
  uniqueTracks: number;
  uniqueFound: number;
  playlists: PlaylistCoverage[];
  missing: Track[];
}

const median = (xs: number[]) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0));

export function summarise(playlists: PlaylistInput[], features: Map<string, Features>): CoverageReport {
  const unique = new Map<string, Track>();
  for (const p of playlists) for (const t of p.tracks) unique.set(t.id, t);

  // z-score each distance feature over every found track, once each.
  const found = [...unique.keys()].filter((id) => features.has(id));
  const stats = DISTANCE_KEYS.map((k) => {
    const xs = found.map((id) => features.get(id)![k]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  });
  const vec = (f: Features) => DISTANCE_KEYS.map((k, i) => (f[k] - stats[i].mean) / stats[i].sd);

  const groups = playlists.map((p) => {
    const vecs = p.tracks.filter((t) => features.has(t.id)).map((t) => ({ track: t, v: vec(features.get(t.id)!) }));
    const sum = DISTANCE_KEYS.map((_, i) => vecs.reduce((a, x) => a + x.v[i], 0));
    return { p, vecs, sum };
  });
  const centre = (sum: number[], n: number) => sum.map((x) => x / n);

  const report: PlaylistCoverage[] = groups.map(({ p, vecs, sum }) => {
    const fs = p.tracks.map((t) => features.get(t.id)).filter((f): f is Features => !!f);
    const med = (k: keyof PlaylistCoverage['median'] & keyof Features) => median(fs.map((f) => f[k]));
    let nearestOwn = 0;
    const outliers: PlaylistCoverage['outliers'] = [];
    for (const { track, v } of vecs) {
      if (vecs.length < 2) continue;
      // Leave the track out of its own centre, or it always looks closest to home.
      const own = centre(
        sum.map((s, i) => s - v[i]),
        vecs.length - 1,
      );
      const dOwn = dist(v, own);
      const nearer = groups.some((g) => g.p !== p && g.vecs.length > 0 && dist(v, centre(g.sum, g.vecs.length)) < dOwn);
      if (!nearer) nearestOwn++;
      if (dOwn > OUTLIER_DISTANCE) outliers.push({ track, distance: dOwn });
    }
    outliers.sort((a, b) => b.distance - a.distance);
    return {
      id: p.id,
      name: p.name,
      tracks: p.tracks.length,
      found: fs.length,
      median: {
        tempo: med('tempo'),
        energy: med('energy'),
        valence: med('valence'),
        instrumentalness: med('instrumentalness'),
        acousticness: med('acousticness'),
      },
      nearestOwn,
      outliers,
    };
  });

  return {
    uniqueTracks: unique.size,
    uniqueFound: found.length,
    playlists: report,
    missing: [...unique.values()].filter((t) => !features.has(t.id)),
  };
}

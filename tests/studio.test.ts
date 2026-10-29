import { describe, expect, it } from 'vitest';
import { getPlaylistTracks } from '../src/spotify/api';
import { summarise } from '../src/studio/coverage';
import { BATCH, fetchFeatures, spotifyIdOf, type Features } from '../src/studio/reccobeats';
import { json, seedTokens, stubFetch } from './helpers';

const id = (n: number) => `T${String(n).padStart(21, '0')}`;
const feat = (over: Partial<Features> = {}): Features => ({
  tempo: 100,
  energy: 0.5,
  valence: 0.5,
  danceability: 0.5,
  acousticness: 0.5,
  instrumentalness: 0.5,
  loudness: -10,
  speechiness: 0.05,
  liveness: 0.1,
  key: 0,
  mode: 1,
  ...over,
});
const recco = (tid: string, over: Partial<Features> = {}) => ({ id: 'uuid', href: `https://open.spotify.com/track/${tid}`, ...feat(over) });

describe('playlist tracks', () => {
  it('follows pages, reads item (or the old track field), and skips local files and episodes', async () => {
    seedTokens();
    stubFetch((url) => {
      if (url.includes('offset=50')) return json(200, { items: [{ track: { id: id(3), name: 'Old field', artists: [] } }], next: null, total: 4 });
      return json(200, {
        items: [
          { item: { id: id(1), type: 'track', name: 'One', artists: [{ name: 'A' }, { name: 'B' }] } },
          { is_local: true, item: { id: null, name: 'Local' } },
          { item: { id: id(2), type: 'episode', name: 'Podcast' } },
          null,
        ],
        next: 'https://api.spotify.com/v1/playlists/p/items?offset=50&limit=50',
        total: 4,
      });
    });
    expect(await getPlaylistTracks('p')).toEqual([
      { id: id(1), name: 'One', artists: 'A, B' },
      { id: id(3), name: 'Old field', artists: '' },
    ]);
  });
});

describe('ReccoBeats', () => {
  it('reads the Spotify ID from href', () => {
    expect(spotifyIdOf('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp')).toBe('3n3Ppam7vgaVa1iaRUc9Lp');
    expect(spotifyIdOf('nope')).toBeNull();
  });

  it(`asks in batches of ${BATCH}, once per ID, and leaves unknown tracks out`, async () => {
    const ids = Array.from({ length: 45 }, (_, i) => id(i));
    const urls: string[] = [];
    const found = await fetchFeatures([...ids, id(0)], {
      fetch: async (u) => {
        urls.push(String(u));
        const asked = new URL(String(u)).searchParams.get('ids')!.split(',');
        return json(200, { content: asked.filter((t) => t !== id(7)).map((t) => recco(t)) });
      },
    });
    expect(urls.map((u) => new URL(u).searchParams.get('ids')!.split(',').length)).toEqual([40, 5]);
    expect(found.size).toBe(44);
    expect(found.has(id(7))).toBe(false);
  });

  it('waits out a 429, then carries on', async () => {
    const waits: number[] = [];
    let calls = 0;
    const found = await fetchFeatures([id(1)], {
      fetch: async () => (++calls === 1 ? json(429, {}, { 'Retry-After': '3' }) : json(200, { content: [recco(id(1))] })),
      sleep: async (ms) => void waits.push(ms),
    });
    expect(waits).toEqual([3000]);
    expect(found.size).toBe(1);
  });

  it('ignores malformed entries', async () => {
    const found = await fetchFeatures([id(1), id(2)], {
      fetch: async () => json(200, { content: [{ href: `https://open.spotify.com/track/${id(1)}`, tempo: 'fast' }, recco(id(2))] }),
    });
    expect([...found.keys()]).toEqual([id(2)]);
  });

  it('fails clearly on other errors', async () => {
    await expect(fetchFeatures([id(1)], { fetch: async () => json(500, {}) })).rejects.toThrow('ReccoBeats: HTTP 500');
  });
});

describe('coverage summary', () => {
  const t = (n: number) => ({ id: id(n), name: `Track ${n}`, artists: 'X' });

  it('counts found tracks per playlist and overall, sharing tracks once', () => {
    const features = new Map([
      [id(1), feat()],
      [id(2), feat()],
    ]);
    const r = summarise(
      [
        { id: 'a', name: 'A', tracks: [t(1), t(2), t(3)] },
        { id: 'b', name: 'B', tracks: [t(2), t(4)] },
      ],
      features,
    );
    expect(r.uniqueTracks).toBe(4);
    expect(r.uniqueFound).toBe(2);
    expect(r.playlists.map((p) => [p.tracks, p.found])).toEqual([
      [3, 2],
      [2, 1],
    ]);
    expect(r.missing.map((m) => m.id)).toEqual([id(3), id(4)]);
  });

  const calmAndLoud = (calmCount: number) => {
    const features = new Map<string, Features>();
    const calm = Array.from({ length: calmCount }, (_, i) => t(i + 1));
    const loud = [61, 62, 63, 64, 65].map(t);
    calm.forEach((x, i) => features.set(x.id, feat({ energy: 0.1 + (i % 4) * 0.01, tempo: 70 + (i % 3), loudness: -25 })));
    loud.forEach((x, i) => features.set(x.id, feat({ energy: 0.9 - i * 0.01, tempo: 150 - i, loudness: -5 })));
    const intruder = t(99);
    features.set(intruder.id, feat({ energy: 0.95, tempo: 160, loudness: -4 }));
    const r = summarise(
      [
        { id: 'calm', name: 'Calm', tracks: [...calm, intruder] },
        { id: 'loud', name: 'Loud', tracks: loud },
      ],
      features,
    );
    return { r, calm, intruder };
  };

  it('tells calm and loud playlists apart, and flags the loud track in the calm one, saying why', () => {
    const { r, calm, intruder } = calmAndLoud(9);
    const [c, l] = r.playlists;
    expect(c.nearestOwn).toBe(calm.length); // all but the intruder
    expect(l.nearestOwn).toBe(5);
    expect(c.outliers.map((o) => o.track.id)).toEqual([intruder.id]);
    const [first] = c.outliers[0].reasons;
    expect(['energy', 'tempo', 'loudness']).toContain(first.feature);
    expect(first.value).toBeGreaterThan(first.typical);
  });

  it('judges no outliers in a playlist with fewer than 8 found tracks', () => {
    expect(calmAndLoud(6).r.playlists[0].outliers).toEqual([]);
  });

  it('judges a track against its own playlist’s spread: a varied playlist flags nothing', () => {
    const features = new Map<string, Features>();
    const varied = Array.from({ length: 12 }, (_, i) => t(i + 1));
    varied.forEach((x, i) => features.set(x.id, feat({ energy: (i % 6) / 6, tempo: 60 + ((i * 37) % 100), valence: ((i * 5) % 12) / 12 })));
    const r = summarise([{ id: 'v', name: 'Varied', tracks: varied }], features);
    expect(r.playlists[0].outliers).toEqual([]);
  });
});

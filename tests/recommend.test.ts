import { describe, expect, it } from 'vitest';
import type { Features } from '../src/studio/reccobeats';
import { buildIndex, evaluate, suggest } from '../src/studio/recommend';
import type { Track } from '../src/spotify/types';

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
let n = 0;
const track = (artist: string, album: string | null = null): Track => {
  n++;
  return { id: `T${String(n).padStart(21, '0')}`, name: `Track ${n}`, artists: artist, artistKeys: [artist.toLowerCase()], album, position: 0 };
};

describe('suggestions for a track', () => {
  const kyd = [track('Jesper Kyd', 'AC2'), track('Jesper Kyd', 'AC2'), track('Jesper Kyd')];
  const graves = [track('Jason Graves'), track('Jason Graves'), track('Jason Graves')];
  const playlists = [
    { id: 'town', name: 'Town: Busy Town', tracks: [...kyd, track('Someone')] },
    { id: 'cave', name: 'Setting: Quiet Cave', tracks: [...graves, track('Other')] },
    { id: 'big', name: 'Mood: Eerie', tracks: Array.from({ length: 30 }, () => track('Filler')) },
  ];

  it('puts the playlist with the same composer first, saying why', () => {
    const index = buildIndex(playlists, new Map());
    const [first] = suggest(track('Jesper Kyd'), index, { artist: 1, album: 1, sound: 0 });
    expect(first.playlistId).toBe('town');
    expect(first.reasons).toEqual(['3 tracks by Jesper Kyd']);
  });

  it('counts the same album too', () => {
    const index = buildIndex(playlists, new Map());
    const [first] = suggest(track('Unknown', 'AC2'), index, { artist: 1, album: 1, sound: 0 });
    expect(first).toMatchObject({ playlistId: 'town', reasons: ['2 from the same album'] });
  });

  it('leaves out playlists the track is already in', () => {
    const index = buildIndex(playlists, new Map());
    expect(suggest(kyd[0], index, { artist: 1, album: 1, sound: 0 }).map((s) => s.playlistId)).not.toContain('town');
  });

  it('uses sound when there is no composer or album to go on', () => {
    const features = new Map<string, Features>();
    playlists[0].tracks.forEach((t) => features.set(t.id, feat({ energy: 0.9, tempo: 150 })));
    playlists[1].tracks.forEach((t) => features.set(t.id, feat({ energy: 0.1, tempo: 70 })));
    playlists[2].tracks.forEach((t, i) => features.set(t.id, feat({ energy: i / 30, tempo: 60 + i * 4 })));
    const loud = track('Nobody');
    features.set(loud.id, feat({ energy: 0.92, tempo: 148 }));
    const index = buildIndex(playlists, features);
    const [first] = suggest(loud, index, { artist: 1, album: 1, sound: 0.3 });
    expect(first).toMatchObject({ playlistId: 'town', reasons: ['sounds alike'] });
  });
});

describe('evaluation', () => {
  it('treats each track as new: composer finds its playlist, the size baseline doesn’t', () => {
    const a = Array.from({ length: 6 }, () => track('Composer A'));
    const b = Array.from({ length: 6 }, () => track('Composer B'));
    const filler = Array.from({ length: 20 }, (_, i) => track(`Filler ${i}`));
    const rows = evaluate(
      [
        { id: 'a', name: 'A', tracks: a },
        { id: 'b', name: 'B', tracks: b },
        { id: 'f', name: 'F', tracks: filler },
      ],
      new Map(),
      [
        { label: 'size', weights: { artist: 0, album: 0, sound: 0, size: 1 } },
        { label: 'composer', weights: { artist: 1, album: 0, sound: 0 } },
      ],
    );
    expect(rows[0]).toMatchObject({ tracks: 32, hit1: 20 }); // only the filler tracks
    expect(rows[1].hit1).toBe(12 + 0); // A and B tracks found by composer; each filler artist is unique
  });
});

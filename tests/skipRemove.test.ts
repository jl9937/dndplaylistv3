import { describe, expect, it } from 'vitest';
import { canWritePlaylists, removeTarget, removeTrack, restoreTrack, stillPlaying } from '../src/playback/skipRemove';
import { addToPlaylist, play, removeFromPlaylist, renamePlaylist } from '../src/spotify/api';
import type { PlaybackState, Playlist } from '../src/spotify/types';
import { write } from '../src/storage';
import { empty, json, seedTokens, stubFetch } from './helpers';

const playlist = (id: string, owner: string): Playlist => ({ id, name: `Town: ${id}`, uri: `spotify:playlist:${id}`, images: null, owner: { id: owner } });
const byId = new Map([
  ['mine', playlist('mine', 'jim')],
  ['theirs', playlist('theirs', 'someone')],
]);
const playing = (contextUri: string | null, trackId = 'T1'): PlaybackState => ({
  device: null,
  is_playing: true,
  progress_ms: 0,
  shuffle_state: true,
  repeat_state: 'context',
  context: contextUri ? { uri: contextUri, type: 'playlist' } : null,
  item: { id: trackId, name: 'Wrong Vibe' },
});
const target = { playlistId: 'mine', playlistName: 'Town: mine', trackId: 'T1', trackName: 'Wrong Vibe' };

describe('skip and remove', () => {
  it('acts on the playing track of a playlist I own', () => {
    expect(removeTarget(playing('spotify:playlist:mine'), byId, 'jim')).toEqual(target);
  });

  it('says why it can’t act', () => {
    expect(removeTarget(null, byId, 'jim')).toEqual({ reason: 'Nothing is playing.' });
    expect(removeTarget(playing(null), byId, 'jim')).toEqual({ reason: 'Only works while a playlist is playing.' });
    expect(removeTarget(playing('spotify:playlist:unknown'), byId, 'jim')).toMatchObject({ reason: expect.stringContaining('library') });
    expect(removeTarget(playing('spotify:playlist:theirs'), byId, 'jim')).toMatchObject({ reason: expect.stringContaining('your own') });
  });

  it('remembers the track’s position, removes it, and Undo puts it back there', async () => {
    const calls: string[] = [];
    const position = await removeTrack(target, {
      getTracks: async () => [
        { id: 'T0', name: '', artists: '', position: 0 },
        { id: 'T1', name: '', artists: '', position: 2 }, // a local file sits at 1
      ],
      remove: async (id, uris) => void calls.push(`remove ${id} ${uris}`),
    });
    expect(position).toEqual([2]);
    await restoreTrack(target, position, { add: async (id, uris, at) => void calls.push(`add ${id} ${uris} @${at}`) });
    expect(calls).toEqual(['remove mine spotify:track:T1', 'add mine spotify:track:T1 @2']);
  });

  it('a track in the playlist twice: both copies come back where they were', async () => {
    const adds: number[] = [];
    const positions = await removeTrack(target, {
      getTracks: async () => [
        { id: 'T1', name: '', artists: '', position: 5 },
        { id: 'T0', name: '', artists: '', position: 1 },
        { id: 'T1', name: '', artists: '', position: 0 },
      ],
      remove: async () => {},
    });
    await restoreTrack(target, positions, { add: async (_id, _uris, at) => void adds.push(at!) });
    expect(adds).toEqual([0, 5]);
  });

  it('checks the track is still the one playing before removing it', () => {
    expect(stillPlaying(target, playing('spotify:playlist:mine'))).toBe(true);
    expect(stillPlaying(target, playing('spotify:playlist:mine', 'T2'))).toBe(false);
    expect(stillPlaying(target, playing('spotify:playlist:theirs'))).toBe(false);
  });

  it('removes nothing if the track has already gone', async () => {
    let removed = false;
    await expect(
      removeTrack(target, { getTracks: async () => [], remove: async () => void (removed = true) }),
    ).rejects.toThrow('no longer in the playlist');
    expect(removed).toBe(false);
  });

  it('needs both write scopes, which tokens from before Milestone 5 lack', () => {
    seedTokens();
    write('auth.tokens', { accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 1e6, loginAt: Date.now(), scope: 'streaming' });
    expect(canWritePlaylists()).toBe(false);
    write('auth.tokens', {
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: Date.now() + 1e6,
      loginAt: Date.now(),
      scope: 'streaming playlist-modify-private playlist-modify-public',
    });
    expect(canWritePlaylists()).toBe(true);
  });
});

describe('play request', () => {
  it('starts at a track by URI when given one, else at a position', async () => {
    seedTokens();
    const bodies: unknown[] = [];
    stubFetch((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return empty(204);
    });
    await play('d1', { contextUri: 'spotify:playlist:p', offsetUri: 'spotify:track:T7' });
    await play('d1', { contextUri: 'spotify:playlist:p', offsetPosition: 3 });
    expect(bodies).toEqual([
      { context_uri: 'spotify:playlist:p', offset: { uri: 'spotify:track:T7' } },
      { context_uri: 'spotify:playlist:p', offset: { position: 3 } },
    ]);
  });
});

describe('playlist write calls', () => {
  it('send the 2026 request bodies', async () => {
    seedTokens();
    const sent: { method?: string; url: string; body: unknown }[] = [];
    stubFetch((url, init) => {
      sent.push({ method: init.method, url, body: JSON.parse(String(init.body)) });
      return json(200, { snapshot_id: 'abc' });
    });
    await removeFromPlaylist('p1', ['spotify:track:T1']);
    await addToPlaylist('p1', ['spotify:track:T1'], 2);
    await renamePlaylist('p1', 'Town: Desert Town [Desert]');
    expect(sent).toEqual([
      { method: 'DELETE', url: 'https://api.spotify.com/v1/playlists/p1/items', body: { items: [{ uri: 'spotify:track:T1' }] } },
      { method: 'POST', url: 'https://api.spotify.com/v1/playlists/p1/items', body: { uris: ['spotify:track:T1'], position: 2 } },
      { method: 'PUT', url: 'https://api.spotify.com/v1/playlists/p1', body: { name: 'Town: Desert Town [Desert]' } },
    ]);
  });
});

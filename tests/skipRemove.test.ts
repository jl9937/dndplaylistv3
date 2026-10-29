import { describe, expect, it } from 'vitest';
import { canWritePlaylists, removeTarget, removeTrack, restoreTrack } from '../src/playback/skipRemove';
import { addToPlaylist, removeFromPlaylist, renamePlaylist } from '../src/spotify/api';
import type { PlaybackState, Playlist } from '../src/spotify/types';
import { write } from '../src/storage';
import { json, seedTokens, stubFetch } from './helpers';

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
    expect(position).toBe(2);
    await restoreTrack(target, position, { add: async (id, uris, at) => void calls.push(`add ${id} ${uris} @${at}`) });
    expect(calls).toEqual(['remove mine spotify:track:T1', 'add mine spotify:track:T1 @2']);
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

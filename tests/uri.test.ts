import { describe, expect, it } from 'vitest';
import { parsePlaylistId, playlistUri } from '../src/spotify/uri';

describe('parsePlaylistId', () => {
  it.each([
    ['spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', '37i9dQZF1DXcBWIGoYBM5M'],
    ['spotify:user:jim:playlist:37i9dQZF1DXcBWIGoYBM5M', '37i9dQZF1DXcBWIGoYBM5M'],
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc', '37i9dQZF1DXcBWIGoYBM5M'],
    ['https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M', '37i9dQZF1DXcBWIGoYBM5M'],
  ])('%s', (uri, id) => {
    expect(parsePlaylistId(uri)).toBe(id);
  });

  it.each([null, undefined, '', 'spotify:album:123', 'spotify:artist:abc'])('rejects %s', (uri) => {
    expect(parsePlaylistId(uri)).toBeNull();
  });

  it('round-trips', () => {
    expect(parsePlaylistId(playlistUri('abc123'))).toBe('abc123');
  });
});

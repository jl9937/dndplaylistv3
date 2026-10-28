import { describe, expect, it } from 'vitest';
import { getLibrary, loadLibrary } from '../src/library/libraryStore';
import { read, write } from '../src/storage';
import { json, seedTokens, stubFetch } from './helpers';

const playlist = (id: string, name: string) => ({
  id,
  name,
  uri: `spotify:playlist:${id}`,
  images: [
    { url: 'big', width: 640, height: 640 },
    { url: 'small', width: 60, height: 60 },
    { url: 'mid', width: 300, height: 300 },
  ],
  owner: { id: 'jim', display_name: 'Jim' },
  items: { total: 12 },
  description: 'not cached',
});

function spotify(playlists: unknown[]) {
  return stubFetch((url) => {
    if (url.includes('/me/playlists')) return json(200, { items: playlists, next: null, total: playlists.length });
    if (url.endsWith('/me')) return json(200, { id: 'jim' });
    return json(404, {});
  });
}

describe('library cache', () => {
  it('fetches, then caches a slim copy (one cover, no description)', async () => {
    seedTokens();
    spotify([playlist('a', 'Town: A')]);
    await loadLibrary();
    expect(getLibrary()).toMatchObject({ status: 'ok', myId: 'jim', refreshError: null });
    const cached = read<{ playlists: Record<string, unknown>[] }>('cache.library')!;
    expect(cached.playlists[0]).toEqual({
      id: 'a',
      name: 'Town: A',
      uri: 'spotify:playlist:a',
      images: [{ url: 'mid', width: 300, height: 300 }],
      owner: { id: 'jim', display_name: 'Jim' },
      items: { total: 12 },
    });
  });

  it('shows the cache at once, and keeps it if the refresh fails', async () => {
    seedTokens();
    write('cache.library', { at: 1, myId: 'jim', playlists: [playlist('old', 'Town: Cached')] });
    stubFetch(() => {
      throw new TypeError('offline');
    });
    const loading = loadLibrary();
    expect(getLibrary()).toMatchObject({ status: 'ok' }); // before the network answers
    await loading;
    const lib = getLibrary();
    expect(lib.status === 'ok' && lib.playlists.map((p) => p.id)).toEqual(['old']);
    expect(lib).toMatchObject({ refreshError: expect.stringContaining('No connection') });
  });

  it('is an error with no cache and no network', async () => {
    seedTokens();
    stubFetch(() => {
      throw new TypeError('offline');
    });
    await loadLibrary();
    expect(getLibrary()).toMatchObject({ status: 'error' });
  });
});

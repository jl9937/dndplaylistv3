import { describe, expect, it } from 'vitest';
import { fileTrack, unfileTrack } from '../src/studio/filing';

const tr = (id: string, position = 0) => ({ id, name: '', artists: '', position });

describe('filing a track from the holding playlist', () => {
  it('copies it into the playlist', async () => {
    const adds: string[] = [];
    const r = await fileTrack('T1', 'town', { getTracks: async () => [tr('T0')], add: async (p, u) => void adds.push(`${p} ${u}`) });
    expect(r).toBe('copied');
    expect(adds).toEqual(['town spotify:track:T1']);
  });

  it('doesn’t make a duplicate when it’s already there', async () => {
    const adds: string[] = [];
    const r = await fileTrack('T1', 'town', { getTracks: async () => [tr('T1')], add: async (p) => void adds.push(p) });
    expect(r).toBe('already');
    expect(adds).toEqual([]);
  });

  it('undo removes the copy when it’s the only one', async () => {
    const removes: string[] = [];
    await unfileTrack('T1', 'town', { getTracks: async () => [tr('T0'), tr('T1')], remove: async (p) => void removes.push(p) });
    expect(removes).toEqual(['town']);
  });

  it('undo never removes a copy that was there before (Spotify would remove both)', async () => {
    const removes: string[] = [];
    await expect(
      unfileTrack('T1', 'town', { getTracks: async () => [tr('T1', 0), tr('T1', 4)], remove: async (p) => void removes.push(p) }),
    ).rejects.toThrow('more than once');
    expect(removes).toEqual([]);
  });

  it('undo does nothing when the copy has already gone', async () => {
    const removes: string[] = [];
    await unfileTrack('T1', 'town', { getTracks: async () => [], remove: async (p) => void removes.push(p) });
    expect(removes).toEqual([]);
  });
});

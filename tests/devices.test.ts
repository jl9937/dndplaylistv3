import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore, firstRunDefault, loadDevicePref, matchDevice, saveDevicePref } from '../src/playback/devices';
import type { Device } from '../src/spotify/types';

const dev = (over: Partial<Device>): Device => ({
  id: 'id1',
  name: 'Jim’s MacBook',
  type: 'Computer',
  is_active: false,
  is_restricted: false,
  volume_percent: 50,
  ...over,
});

describe('matchDevice', () => {
  it('matches on name and type, never on id', () => {
    const list = [dev({ id: 'new-id-after-restart' })];
    expect(matchDevice(list, { name: 'Jim’s MacBook', type: 'Computer' })?.id).toBe('new-id-after-restart');
  });

  it('is case-insensitive on type only', () => {
    expect(matchDevice([dev({ type: 'computer' })], { name: 'Jim’s MacBook', type: 'Computer' })).toBeDefined();
    expect(matchDevice([dev({})], { name: 'jim’s macbook', type: 'Computer' })).toBeUndefined();
  });

  it('skips restricted devices and those without an id', () => {
    const pref = { name: 'Jim’s MacBook', type: 'Computer' };
    expect(matchDevice([dev({ is_restricted: true })], pref)).toBeUndefined();
    expect(matchDevice([dev({ id: null })], pref)).toBeUndefined();
  });

  it('prefers the active device when names collide', () => {
    const list = [dev({ id: 'a' }), dev({ id: 'b', is_active: true })];
    expect(matchDevice(list, { name: 'Jim’s MacBook', type: 'Computer' })?.id).toBe('b');
  });

  it('returns undefined with no pref', () => {
    expect(matchDevice([dev({})], null)).toBeUndefined();
  });
});

describe('firstRunDefault', () => {
  it('preselects the only Computer', () => {
    expect(firstRunDefault([dev({}), dev({ id: 'p', name: 'Phone', type: 'Smartphone' })])?.id).toBe('id1');
  });

  it('does not guess between several computers', () => {
    expect(firstRunDefault([dev({ id: 'a' }), dev({ id: 'b', name: 'Other' })])).toBeUndefined();
  });

  it('returns undefined with no computer', () => {
    expect(firstRunDefault([dev({ type: 'Smartphone' })])).toBeUndefined();
  });
});

describe('device pref storage', () => {
  it('stores only name and type', () => {
    saveDevicePref({ name: 'Laptop', type: 'Computer', id: 'x' } as never);
    expect(loadDevicePref()).toEqual({ name: 'Laptop', type: 'Computer' });
  });
});

describe('createDeviceStore', () => {
  it('serves the cache for 30 s, then refetches', async () => {
    let t = 1_000;
    const fetcher = vi.fn(async () => [dev({})]);
    const store = createDeviceStore(fetcher, () => t);
    await store.get();
    t += 29_000;
    await store.get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t += 2_000;
    await store.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight refresh', async () => {
    const fetcher = vi.fn(async () => [dev({})]);
    const store = createDeviceStore(fetcher);
    await Promise.all([store.refresh(), store.refresh(), store.get()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

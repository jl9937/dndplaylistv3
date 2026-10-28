import { describe, expect, it, vi } from 'vitest';
import type { PlayerDevice } from '../src/playback/device';
import { createDeviceStore } from '../src/playback/devices';
import type { Pipeline } from '../src/playback/pipeline';
import { createPlayback } from '../src/playback/playback';
import { BROWSER_PREF } from '../src/player/sdkDevice';
import type { SdkStatus } from '../src/player/webPlayback';
import type { Device, PlaybackState } from '../src/spotify/types';

const mac: Device = { id: 'mac1', name: 'MacBook Pro', type: 'Computer', is_active: true, is_restricted: false, volume_percent: 50 };

function setup(opts: { devices?: Device[]; sdk?: SdkStatus } = {}) {
  const used: string[] = [];
  const pipeline = {
    press: vi.fn(async (_p, d: PlayerDevice) => {
      await d.resolve(new AbortController().signal);
      used.push(`press:${d.label}`);
      return { status: 'idle' };
    }),
    pause: vi.fn(async (d: PlayerDevice) => (used.push(`pause:${d.label}`), { status: 'idle' })),
    resume: vi.fn(async (d: PlayerDevice) => (used.push(`resume:${d.label}`), { status: 'idle' })),
    next: vi.fn(async (d: PlayerDevice) => (used.push(`next:${d.label}`), null)),
  } as unknown as Pipeline;
  const browser = { label: 'This browser', resolve: vi.fn(async () => 'sdk1') } as unknown as PlayerDevice;
  const store = createDeviceStore(async () => opts.devices ?? [mac]);
  const notify = vi.fn();
  const playback = createPlayback({
    pipeline,
    store,
    browser,
    sdkStatus: () => opts.sdk ?? { state: 'ready', deviceId: 'sdk1' },
    notify,
  });
  return { playback, used, notify, browser };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const playingOn = (device: Partial<Device>, isPlaying = true) => ({ device, is_playing: isPlaying }) as PlaybackState;

describe('playback entry point', () => {
  it('needs a chosen device', () => {
    expect(setup().playback.play({ id: 'p' }, null)).toBe(false);
  });

  it('plays on the chosen device and clears any notice', async () => {
    const { playback, used, notify } = setup();
    expect(playback.play({ id: 'p' }, { name: 'MacBook Pro', type: 'Computer' })).toBe(true);
    await flush();
    expect(used).toEqual(['press:MacBook Pro']);
    expect(notify).toHaveBeenCalledWith(null);
  });

  it('falls back to this window, with a notice, when the chosen app is not open', async () => {
    const { playback, used, notify } = setup({ devices: [] });
    playback.play({ id: 'p' }, { name: 'MacBook Pro', type: 'Computer' });
    await flush();
    expect(used).toEqual(['press:This browser']);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('playing in this window'));
  });

  it('does not fall back when the in-browser player is unavailable', async () => {
    const { playback, used } = setup({ devices: [], sdk: { state: 'off', reason: 'needs-scope' } });
    playback.play({ id: 'p' }, { name: 'MacBook Pro', type: 'Computer' });
    await flush();
    expect(used).toEqual([]); // the press itself reports "Spotify isn't open"
  });

  it('"This browser" chosen: plays there directly', async () => {
    const { playback, used } = setup();
    playback.play({ id: 'p' }, BROWSER_PREF);
    await flush();
    expect(used).toEqual(['press:This browser']);
  });

  it('Pause and Next go to whatever is actually playing (this window after a fallback)', async () => {
    const { playback, used } = setup();
    const mac = { name: 'MacBook Pro', type: 'Computer' };
    playback.togglePause(mac, playingOn({ id: 'sdk1', name: 'D&D Playlist Manager' }));
    await playback.next(mac, playingOn({ id: 'sdk1', name: 'D&D Playlist Manager' }));
    playback.togglePause(mac, playingOn({ id: 'mac1', name: 'MacBook Pro' }, false));
    expect(used).toEqual(['pause:This browser', 'next:This browser', 'resume:MacBook Pro']);
  });

  it('deviceFor has no fallback (for the Ready check)', () => {
    const { playback, browser } = setup();
    expect(playback.deviceFor(BROWSER_PREF)).toBe(browser);
    expect(playback.deviceFor({ name: 'MacBook Pro', type: 'Computer' })?.label).toBe('MacBook Pro');
    expect(playback.deviceFor(null)).toBeNull();
  });
});

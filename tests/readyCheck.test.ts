import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceMissingError, type PlayerDevice } from '../src/playback/device';
import type { Pipeline, PressState } from '../src/playback/pipeline';
import { runReadyCheck, type ReadyStep } from '../src/playback/readyCheck';
import { json, seedTokens, stubFetch } from './helpers';

const playlist = { id: 'PL1', name: 'Town: Market', total: 5 };
const pref = { name: 'MacBook Pro', type: 'Computer' };

function device(resolve: () => Promise<string> = async () => 'mac1'): PlayerDevice {
  return { label: 'MacBook Pro', resolve: vi.fn(resolve) } as unknown as PlayerDevice;
}

function pipeline(pressResult: PressState, pauseResult: PressState = { status: 'paused', seq: 2, playlistId: 'PL1', deviceLabel: 'MacBook Pro' }) {
  return { press: vi.fn(async () => pressResult), pause: vi.fn(async () => pauseResult) } as unknown as Pipeline;
}

const playing: PressState = { status: 'playing', seq: 1, playlistId: 'PL1', deviceLabel: 'MacBook Pro' };
const byKey = (steps: ReadyStep[]) => Object.fromEntries(steps.map((s) => [s.key, s.status]));

async function run(overrides: Partial<Parameters<typeof runReadyCheck>[0]> = {}) {
  const p = runReadyCheck({ pref, playlist, pipeline: pipeline(playing), makeDevice: () => device(), onUpdate: () => {}, ...overrides });
  await vi.advanceTimersByTimeAsync(1_000);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  seedTokens();
  stubFetch(() => json(200, { is_playing: true, shuffle_state: true, repeat_state: 'context', device: null, context: null, item: null }));
});

describe('Ready check', () => {
  it('all green when everything works, and the test play is paused afterwards', async () => {
    const pl = pipeline(playing);
    const steps = await run({ pipeline: pl });
    expect(byKey(steps)).toEqual({ token: 'ok', device: 'ok', play: 'ok', mode: 'ok' });
    expect(pl.pause).toHaveBeenCalled();
  });

  it('stops at the device step when the app is not open', async () => {
    const steps = await run({
      makeDevice: () =>
        device(async () => {
          throw new DeviceMissingError('MacBook Pro');
        }),
    });
    expect(byKey(steps)).toEqual({ token: 'ok', device: 'fail', play: 'fail', mode: 'fail' });
    expect(steps.find((s) => s.key === 'device')?.detail).toContain("isn't open");
  });

  it('needs a device and a test playlist', async () => {
    expect(byKey(await run({ pref: null }))).toMatchObject({ device: 'fail', play: 'fail' });
    expect(byKey(await run({ playlist: null }))).toMatchObject({ device: 'ok', play: 'fail' });
  });

  it('reports a failed test play with its reason', async () => {
    const failed: PressState = { status: 'failed', seq: 1, playlistId: 'PL1', reason: 'Spotify Premium required.', deviceMissing: false };
    const steps = await run({ pipeline: pipeline(failed) });
    expect(steps.find((s) => s.key === 'play')).toMatchObject({ status: 'fail', detail: 'Spotify Premium required.' });
  });

  it('warns when shuffle or repeat are not set, or pausing fails', async () => {
    stubFetch(() => json(200, { is_playing: true, shuffle_state: false, repeat_state: 'off', device: null, context: null, item: null }));
    const steps = await run({ pipeline: pipeline(playing, { status: 'failed', seq: 2, playlistId: 'PL1', reason: 'x', deviceMissing: false }) });
    expect(byKey(steps)).toMatchObject({ mode: 'warn', play: 'warn' });
  });

  it('fails everything after a missing login', async () => {
    localStorage.clear();
    expect(byKey(await run())).toEqual({ token: 'fail', device: 'fail', play: 'fail', mode: 'fail' });
  });
});

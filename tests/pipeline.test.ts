import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPipeline,
  DeviceMissingError,
  type Observation,
  type PlayerDevice,
} from '../src/playback/pipeline';
import type { PlayRequest } from '../src/spotify/api';
import { SpotifyError } from '../src/spotify/client';
import { parsePlaylistId } from '../src/spotify/uri';

/**
 * A scriptable fake Spotify Connect device. By default a play command starts the
 * playlist and every observation shows the position advancing.
 */
function fakeDevice() {
  const plays: PlayRequest[] = [];
  let current: { playlistId: string | null; progress: number; playing: boolean } | null = null;
  const fake = {
    /** How observe() behaves: 'normal', 'nothing' (204), or 'stalled' (ours, not advancing). */
    mode: 'normal' as 'normal' | 'nothing' | 'stalled',
    shuffle: false,
    repeat: 'off' as Observation['repeat'],
    plays,
    start(playlistId: string) {
      current = { playlistId, progress: 0, playing: true };
    },
  };
  const device: PlayerDevice = {
    label: 'Laptop',
    resolve: vi.fn(async () => 'dev1'),
    sendPlay: vi.fn(async (_id: string, req: PlayRequest) => {
      plays.push(req);
      current = { playlistId: parsePlaylistId(req.contextUri), progress: 0, playing: true };
    }),
    sendResume: vi.fn(async () => {
      if (current) current.playing = true;
    }),
    sendPause: vi.fn(async () => {
      if (current) current.playing = false;
    }),
    sendNext: vi.fn(async () => {}),
    observe: vi.fn(async (): Promise<Observation | null> => {
      if (fake.mode === 'nothing' || !current) return null;
      if (fake.mode === 'normal' && current.playing) current.progress += 1000;
      return {
        deviceId: 'dev1',
        deviceName: 'Laptop',
        playlistId: current.playlistId,
        isPlaying: current.playing,
        progressMs: current.progress,
        trackId: 't1',
        shuffle: fake.shuffle,
        repeat: fake.repeat,
      };
    }),
    wake: vi.fn(async () => {}),
    setShuffle: vi.fn(async () => {}),
    setRepeatContext: vi.fn(async () => {}),
  };
  return { device, fake };
}

const hang = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

beforeEach(() => {
  vi.useFakeTimers();
});

describe('play pipeline', () => {
  it('shows Playing only after observed progress, then enforces shuffle and repeat', async () => {
    const { device } = fakeDevice();
    const pipeline = createPipeline();
    const states: string[] = [];
    pipeline.subscribe(() => states.push(pipeline.getState().status));

    const p = pipeline.press({ id: 'PL1', total: 20 }, device);
    await vi.advanceTimersByTimeAsync(400);
    expect(pipeline.getState().status).toBe('starting'); // accepted, not yet playing
    await vi.advanceTimersByTimeAsync(2_000);
    const final = await p;

    expect(final).toMatchObject({ status: 'playing', playlistId: 'PL1', deviceLabel: 'Laptop' });
    expect(device.observe).toHaveBeenCalledTimes(2);
    expect(device.setShuffle).toHaveBeenCalledWith('dev1', true, expect.anything());
    expect(device.setRepeatContext).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('playing');
  });

  it('skips shuffle/repeat commands when already set', async () => {
    const { device, fake } = fakeDevice();
    fake.shuffle = true;
    fake.repeat = 'context';
    const p = createPipeline().press({ id: 'PL1', total: 5 }, device);
    await vi.advanceTimersByTimeAsync(3_000);
    await p;
    expect(device.setShuffle).not.toHaveBeenCalled();
    expect(device.setRepeatContext).not.toHaveBeenCalled();
  });

  it('starts at a random track within bounds (D14)', async () => {
    for (const [r, total, expected] of [
      [0, 10, 0],
      [0.999, 10, 9],
      [0.5, 1, 0],
    ] as const) {
      const { device, fake } = fakeDevice();
      const p = createPipeline({ random: () => r }).press({ id: 'PL1', total }, device);
      await vi.advanceTimersByTimeAsync(3_000);
      await p;
      expect(fake.plays[0]).toEqual({ contextUri: 'spotify:playlist:PL1', offsetPosition: expected });
    }
  });

  it('sends no offset when the track count is unknown', async () => {
    const { device, fake } = fakeDevice();
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(3_000);
    await p;
    expect(fake.plays[0].offsetPosition).toBeUndefined();
  });

  it('retries a 404 with backoff, looking the device up again', async () => {
    const { device } = fakeDevice();
    let calls = 0;
    const realPlay = device.sendPlay;
    device.sendPlay = vi.fn(async (id, req, signal) => {
      if (calls++ < 2) throw new SpotifyError('not-found', 404, 'Device not found');
      return realPlay(id, req, signal);
    });
    const p = createPipeline().press({ id: 'PL1', total: 3 }, device);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await p).status).toBe('playing');
    expect(device.sendPlay).toHaveBeenCalledTimes(3);
    expect(device.resolve).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('fails with "open Spotify" after repeated 404s', async () => {
    const { device } = fakeDevice();
    device.sendPlay = vi.fn(async () => {
      throw new SpotifyError('not-found', 404, 'Device not found');
    });
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toMatchObject({ status: 'failed', deviceMissing: true });
    expect(device.sendPlay).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const { device } = fakeDevice();
    device.sendPlay = vi.fn(async () => {
      throw new SpotifyError('premium', 403, 'Spotify Premium required.');
    });
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ status: 'failed', reason: 'Spotify Premium required.' });
    expect(device.sendPlay).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the device is not listed', async () => {
    const { device } = fakeDevice();
    device.resolve = vi.fn(async () => {
      throw new DeviceMissingError('Laptop');
    });
    const final = await createPipeline().press({ id: 'PL1' }, device);
    expect(final).toMatchObject({
      status: 'failed',
      reason: "Spotify isn't open on Laptop. Open it, then press again.",
      deviceMissing: true,
    });
    expect(device.sendPlay).not.toHaveBeenCalled();
  });

  it('wakes the device and re-sends once when nothing is active (D3)', async () => {
    const { device, fake } = fakeDevice();
    fake.mode = 'nothing';
    device.wake = vi.fn(async () => {
      fake.mode = 'normal'; // the transfer wakes the desktop app
    });
    const p = createPipeline().press({ id: 'PL1', total: 4 }, device);
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await p).status).toBe('playing');
    expect(device.wake).toHaveBeenCalledTimes(1);
    expect(device.sendPlay).toHaveBeenCalledTimes(2);
  });

  it('does not re-send when our playlist is loaded but not advancing', async () => {
    const { device, fake } = fakeDevice();
    fake.mode = 'stalled';
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_500);
    const final = await p;
    expect(final.status).toBe('failed');
    expect(device.wake).not.toHaveBeenCalled();
    expect(device.sendPlay).toHaveBeenCalledTimes(1);
  });

  it('never re-sends more than once per press', async () => {
    const { device, fake } = fakeDevice();
    fake.mode = 'nothing';
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_500);
    expect(await p).toMatchObject({ status: 'failed' });
    expect(device.sendPlay).toHaveBeenCalledTimes(2);
    expect((await p).status === 'failed' && (await p as { reason: string }).reason).toContain('nothing is playing');
  });

  it('flips Failed to Playing when confirmation arrives late', async () => {
    const { device, fake } = fakeDevice();
    fake.mode = 'nothing';
    const pipeline = createPipeline();
    const p = pipeline.press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_500);
    expect((await p).status).toBe('failed');

    fake.mode = 'normal'; // Spotify finally starts
    await vi.advanceTimersByTimeAsync(6_000);
    expect(pipeline.getState()).toMatchObject({ status: 'playing', playlistId: 'PL1' });
    expect(device.setShuffle).toHaveBeenCalled();
  });

  it('stops the late watch after about 10 s', async () => {
    const { device, fake } = fakeDevice();
    fake.mode = 'nothing';
    const pipeline = createPipeline();
    const p = pipeline.press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_500);
    await p;
    await vi.advanceTimersByTimeAsync(11_000);
    const polls = vi.mocked(device.observe).mock.calls.length;
    fake.mode = 'normal';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(device.observe).mock.calls.length).toBe(polls);
    expect(pipeline.getState().status).toBe('failed');
  });

  it('fails at the 12 s deadline when Spotify never answers', async () => {
    const { device } = fakeDevice();
    device.sendPlay = vi.fn((_id, _req, signal) => hang(signal));
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(11_900);
    expect((await Promise.race([p, Promise.resolve('pending')])) === 'pending').toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toMatchObject({ status: 'failed', reason: "Spotify didn't respond within 12 s." });
  });

  // Seen live 2026-10-28: a press stuck on "Finding device…". Calls that ignore the
  // signal (a shared in-flight request, a lock wait) must not outlast the deadline.
  const never = () => new Promise<never>(() => {});

  it('fails at the deadline even when finding the device hangs and ignores the signal', async () => {
    const { device } = fakeDevice();
    device.resolve = vi.fn(never);
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_100);
    expect(await p).toMatchObject({ status: 'failed', reason: "Spotify didn't respond within 12 s." });
  });

  it('fails at the deadline when observing hangs and ignores the signal', async () => {
    const { device } = fakeDevice();
    device.observe = vi.fn(never);
    const p = createPipeline().press({ id: 'PL1' }, device);
    await vi.advanceTimersByTimeAsync(12_100);
    expect((await p).status).toBe('failed');
  });

  it('pause and resume also fail at the deadline instead of hanging', async () => {
    const { device } = fakeDevice();
    device.resolve = vi.fn(never);
    const pipeline = createPipeline();
    const paused = pipeline.pause(device);
    await vi.advanceTimersByTimeAsync(12_100);
    expect((await paused).status).toBe('failed');
    const resumed = pipeline.resume(device);
    await vi.advanceTimersByTimeAsync(12_100);
    expect((await resumed).status).toBe('failed');
  });

  it('latest press wins: an older press can never reach Playing', async () => {
    const { device } = fakeDevice();
    const realPlay = device.sendPlay;
    device.sendPlay = vi.fn(async (id, req, signal) => {
      if (req.contextUri.endsWith('SLOW')) await new Promise((r) => setTimeout(r, 3_000));
      return realPlay(id, req, signal);
    });
    const pipeline = createPipeline();
    const seen: string[] = [];
    pipeline.subscribe(() => {
      const s = pipeline.getState();
      if (s.status === 'playing') seen.push(s.playlistId);
    });

    const slow = pipeline.press({ id: 'SLOW' }, device);
    await vi.advanceTimersByTimeAsync(100);
    const fast = pipeline.press({ id: 'FAST' }, device);
    await vi.advanceTimersByTimeAsync(8_000);
    await Promise.all([slow, fast]);

    expect(seen).toEqual(['FAST']);
    expect(pipeline.getState()).toMatchObject({ status: 'playing', playlistId: 'FAST' });
  });

  it('a superseded press leaves no Failed state behind', async () => {
    const { device } = fakeDevice();
    device.sendPlay = vi.fn((_id, _req, signal) => hang(signal));
    const pipeline = createPipeline();
    const first = pipeline.press({ id: 'A' }, device);
    await vi.advanceTimersByTimeAsync(100);
    pipeline.reset();
    await first;
    expect(pipeline.getState().status).toBe('idle');
  });
});

describe('gesture', () => {
  it('calls prepareGesture synchronously, before the first await (SDK autoplay policy)', () => {
    const { device } = fakeDevice();
    const prepareGesture = vi.fn();
    device.prepareGesture = prepareGesture;
    void createPipeline().press({ id: 'PL1' }, device);
    expect(prepareGesture).toHaveBeenCalledTimes(1); // no await has happened yet
  });
});

describe('pause and resume', () => {
  it('pauses, treating "already paused" as success', async () => {
    const { device } = fakeDevice();
    device.sendPause = vi.fn(async () => {
      throw new SpotifyError('restriction', 403, 'Restriction violated');
    });
    device.observe = vi.fn(async () => null);
    const final = await createPipeline().pause(device);
    expect(final.status).toBe('paused');
  });

  it('resume is confirmed from observed state', async () => {
    const { device, fake } = fakeDevice();
    fake.start('PL1');
    const pipeline = createPipeline();
    await pipeline.pause(device);
    const p = pipeline.resume(device);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toMatchObject({ status: 'playing', playlistId: 'PL1' });
  });
});

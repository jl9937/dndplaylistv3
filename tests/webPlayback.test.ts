import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebPlayback, type SdkNamespace, type SdkPlayer, type SdkState } from '../src/player/webPlayback';

/** A fake Spotify.Player whose events the test fires. */
class FakePlayer implements SdkPlayer {
  static instances: FakePlayer[] = [];
  static autoReady = true;
  listeners = new Map<string, (arg: never) => void>();
  connected = 0;
  disconnected = 0;
  state: SdkState | null = null;
  constructor(readonly opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void }) {
    FakePlayer.instances.push(this);
  }
  async connect() {
    this.connected++;
    if (FakePlayer.autoReady) setTimeout(() => this.emit('ready', { device_id: `dev-${FakePlayer.instances.length}` }), 50);
    return true;
  }
  disconnect() {
    this.disconnected++;
  }
  addListener(event: string, cb: (arg: never) => void) {
    this.listeners.set(event, cb);
    return true;
  }
  emit(event: string, arg?: unknown) {
    this.listeners.get(event)?.(arg as never);
  }
  async getCurrentState() {
    return this.state;
  }
  async activateElement() {}
  async resume() {}
}

const sdk: SdkNamespace = { Player: FakePlayer as unknown as SdkNamespace['Player'] };
let listed: string[] = [];

function make(overrides: Partial<Parameters<typeof createWebPlayback>[0]> = {}) {
  return createWebPlayback({
    loadSdk: async () => sdk,
    listDeviceIds: async () => listed,
    getToken: async () => 'token',
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePlayer.instances = [];
  FakePlayer.autoReady = true;
  listed = [];
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});

describe('web playback lifecycle', () => {
  it('is ready only once Spotify lists the device, not at the SDK ready event', async () => {
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(60);
    expect(wp.getStatus().state).toBe('waiting');
    listed = ['dev-1'];
    await vi.advanceTimersByTimeAsync(600);
    expect(wp.getStatus()).toEqual({ state: 'ready', deviceId: 'dev-1' });
  });

  it('names the player and fetches tokens through getToken', async () => {
    const getToken = vi.fn(async () => 'T');
    const wp = make({ getToken });
    void wp.start();
    await vi.advanceTimersByTimeAsync(1);
    const p = FakePlayer.instances[0];
    expect(p.opts.name).toBe('D&D Playlist Manager');
    const cb = vi.fn();
    p.opts.getOAuthToken(cb);
    await vi.advanceTimersByTimeAsync(1);
    expect(cb).toHaveBeenCalledWith('T');
  });

  it('reports a blocked SDK script by name', async () => {
    const wp = make({ loadSdk: async () => Promise.reject(new Error('blocked')) });
    await wp.start();
    expect(wp.getStatus()).toMatchObject({ state: 'failed', action: 'allow' });
    expect((wp.getStatus() as { reason: string }).reason).toContain('sdk.scdn.co');
  });

  it('maps SDK error events to named states', async () => {
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(1);
    FakePlayer.instances[0].emit('account_error', { message: 'x' });
    expect(wp.getStatus()).toMatchObject({ state: 'failed', reason: 'Spotify Premium required.' });
    FakePlayer.instances[0].emit('authentication_error', { message: 'x' });
    expect(wp.getStatus()).toMatchObject({ state: 'failed', action: 'relogin' });
  });

  it('recovers after not_ready by reconnecting', async () => {
    listed = ['dev-1'];
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(wp.getStatus().state).toBe('ready');
    listed = [];
    FakePlayer.instances[0].emit('not_ready', { device_id: 'dev-1' });
    expect(wp.getStatus().state).toBe('recovering');
    await vi.advanceTimersByTimeAsync(60); // reconnect emits ready again
    listed = ['dev-1'];
    await vi.advanceTimersByTimeAsync(600);
    expect(wp.getStatus()).toEqual({ state: 'ready', deviceId: 'dev-1' });
    expect(FakePlayer.instances).toHaveLength(1);
  });

  it('rebuilds the player when reconnecting stalls, and asks for a reload if that fails too', async () => {
    listed = ['dev-1'];
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(600);
    FakePlayer.autoReady = false; // connect() now stalls with no ready event
    listed = [];
    FakePlayer.instances[0].emit('not_ready', { device_id: 'dev-1' });
    await vi.advanceTimersByTimeAsync(3_100);
    expect(FakePlayer.instances).toHaveLength(2); // rebuilt
    expect(FakePlayer.instances[0].disconnected).toBe(1);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(wp.getStatus()).toMatchObject({ state: 'failed', action: 'reload' });
  });

  it('ensureReady waits for registration within the deadline, and fresh re-checks /devices', async () => {
    const wp = make();
    void wp.start();
    const ready = wp.ensureReady(AbortSignal.timeout(12_000));
    await vi.advanceTimersByTimeAsync(60);
    listed = ['dev-1'];
    await vi.advanceTimersByTimeAsync(600);
    await expect(ready).resolves.toBe('dev-1');

    // Killed silently (as after sleep): a fresh check notices and recovers.
    wp.kill();
    listed = [];
    const again = wp.ensureReady(AbortSignal.timeout(12_000), true);
    await vi.advanceTimersByTimeAsync(10);
    expect(wp.getStatus().state).toBe('recovering');
    await vi.advanceTimersByTimeAsync(60);
    listed = ['dev-1'];
    await vi.advanceTimersByTimeAsync(600);
    await expect(again).resolves.toBe('dev-1');
  });

  it('ensureReady rejects with a reason when off or failed for good', async () => {
    const wp = make();
    wp.setOff('needs-scope');
    await expect(wp.ensureReady(AbortSignal.timeout(1000))).rejects.toThrow('Log in again');
    wp.setOff('other-tab');
    await expect(wp.ensureReady(AbortSignal.timeout(1000))).rejects.toThrow('another tab');
  });

  it('observes the SDK state as a pipeline observation', async () => {
    listed = ['dev-1'];
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(600);
    FakePlayer.instances[0].state = {
      paused: false,
      position: 1234,
      shuffle: true,
      repeat_mode: 1,
      context: { uri: 'spotify:playlist:PL1' },
      track_window: { current_track: { id: 't1', name: 'Song' } },
    };
    expect(await wp.observe()).toMatchObject({ deviceId: 'dev-1', playlistId: 'PL1', isPlaying: true, repeat: 'context' });
  });

  it('tracks autoplay_failed until playback starts', async () => {
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(1);
    FakePlayer.instances[0].emit('autoplay_failed');
    expect(wp.isAutoplayBlocked()).toBe(true);
    FakePlayer.instances[0].emit('player_state_changed', { paused: false });
    expect(wp.isAutoplayBlocked()).toBe(false);
  });

  it('ignores events from a replaced player', async () => {
    const wp = make();
    void wp.start();
    await vi.advanceTimersByTimeAsync(1);
    const old = FakePlayer.instances[0];
    wp.stop();
    old.emit('account_error', { message: 'x' });
    expect(wp.getStatus()).toEqual({ state: 'off', reason: 'not-started' });
  });
});

// The Web Playback SDK player, "This browser" (Milestone 1b, spec §12.2).
// A module-level singleton created outside React, so StrictMode can never make two.
//
// Lifecycle: off → loading → connecting → waiting (SDK ready) → ready (listed in
// /me/player/devices) → [not_ready | wake] → recovering → ready | failed.

import { log } from '../diagnostics/log';
import type { Observation } from '../playback/pipeline';
import { raceAbort, sleep } from '../sleep';

export const SDK_PLAYER_NAME = 'D&D Playlist Manager';
export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
/** Registration polls after `ready` (the first play after ready often 404s otherwise). */
export const REGISTER_DELAYS_MS = [500, 1000, 2000, 4000];
export const READY_TIMEOUT_MS = 3_000;
export const REBUILD_READY_TIMEOUT_MS = 5_000;
export const FIRST_CONNECT_TIMEOUT_MS = 10_000;
const DRIFT_TICK_MS = 5_000;
const DRIFT_WAKE_MS = 30_000;

// ---------- the parts of the SDK we use ----------

export interface SdkState {
  paused: boolean;
  position: number;
  shuffle: boolean;
  repeat_mode: 0 | 1 | 2;
  context: { uri: string | null } | null;
  track_window: { current_track: { id: string | null; name: string } | null };
}

export interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: never) => void): boolean;
  getCurrentState(): Promise<SdkState | null>;
  activateElement(): Promise<void>;
  resume(): Promise<void>;
}

export interface SdkNamespace {
  Player: new (opts: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume?: number }) => SdkPlayer;
}

// ---------- status ----------

export type OffReason = 'not-started' | 'needs-scope' | 'other-tab';
export type FailAction = 'reload' | 'relogin' | 'allow' | 'none';

export type SdkStatus =
  | { state: 'off'; reason: OffReason }
  | { state: 'loading' | 'connecting' | 'waiting' | 'recovering' }
  | { state: 'ready'; deviceId: string }
  | { state: 'failed'; reason: string; action: FailAction };

export class SdkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdkUnavailableError';
  }
}

export function describeSdk(s: SdkStatus): string {
  switch (s.state) {
    case 'off':
      return s.reason === 'needs-scope'
        ? 'needs a one-time re-login'
        : s.reason === 'other-tab'
          ? 'in use by another tab of this app'
          : 'off';
    case 'loading':
      return 'loading…';
    case 'connecting':
      return 'connecting…';
    case 'waiting':
      return 'waiting for Spotify…';
    case 'recovering':
      return 'reconnecting…';
    case 'ready':
      return 'ready';
    case 'failed':
      return s.reason;
  }
}

function offMessage(reason: OffReason): string {
  if (reason === 'needs-scope') return 'Log in again once to enable playing in this window.';
  if (reason === 'other-tab') return 'The in-browser player is running in another tab of this app.';
  return 'The in-browser player is off.';
}

export interface WebPlaybackDeps {
  loadSdk: () => Promise<SdkNamespace>;
  /** Device IDs currently listed by GET /me/player/devices. */
  listDeviceIds: () => Promise<(string | null)[]>;
  getToken: () => Promise<string>;
}

export function createWebPlayback(deps: WebPlaybackDeps) {
  let status: SdkStatus = { state: 'off', reason: 'not-started' };
  let sdk: SdkNamespace | null = null;
  let player: SdkPlayer | null = null;
  let deviceId: string | null = null;
  let generation = 0;
  let autoplayBlocked = false;
  let readyResolve: ((id: string) => void) | null = null;
  let registering: Promise<void> | null = null;
  let recovering: Promise<void> | null = null;
  let teardown: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((fn) => fn());
  /** Read status through a call, so TypeScript doesn't narrow it across awaits. */
  const current = (): SdkStatus => status;
  function set(next: SdkStatus) {
    const changed = JSON.stringify(next) !== JSON.stringify(status);
    status = next;
    if (changed) log('device', `This browser: ${describeSdk(next)}`);
    notify();
  }

  /** Resolves with the next `ready` device ID, or null after `ms`. */
  function nextReady(ms: number): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        readyResolve = null;
        resolve(null);
      }, ms);
      readyResolve = (id) => {
        clearTimeout(timer);
        readyResolve = null;
        resolve(id);
      };
    });
  }

  async function isListed(id: string): Promise<boolean> {
    try {
      return (await deps.listDeviceIds()).includes(id);
    } catch {
      return true; // a network blip is not evidence that the player died
    }
  }

  /** Poll /devices until our ID shows up (spec §12.2). Shared by every caller for one ID. */
  function ensureRegistered(id: string): Promise<void> {
    if (!registering) {
      const gen = generation;
      registering = (async () => {
        for (const delay of REGISTER_DELAYS_MS) {
          await sleep(delay);
          if (gen !== generation || deviceId !== id) return;
          if (await isListed(id)) {
            set({ state: 'ready', deviceId: id });
            return;
          }
        }
        log('device', 'This browser: not listed by Spotify yet');
      })().finally(() => {
        registering = null;
      });
    }
    return registering;
  }

  function build() {
    const gen = ++generation;
    const live = () => gen === generation;
    const p = new sdk!.Player({
      name: SDK_PLAYER_NAME,
      // The same single-flight getAccessToken() as everything else (spec §12.5).
      getOAuthToken: (cb) => {
        deps.getToken().then(cb, (e: unknown) => log('device', `This browser: no token (${e instanceof Error ? e.message : e})`));
      },
      volume: 0.8,
    });
    const on = <T,>(event: string, fn: (arg: T) => void) => p.addListener(event, ((arg: T) => live() && fn(arg)) as never);

    on<{ device_id: string }>('ready', ({ device_id }) => {
      deviceId = device_id;
      log('device', 'This browser: SDK ready');
      readyResolve?.(device_id);
      if (!recovering) {
        set({ state: 'waiting' });
        void ensureRegistered(device_id);
      }
    });
    on<{ device_id: string }>('not_ready', ({ device_id }) => {
      if (device_id === deviceId) void recover('not_ready event');
    });
    on<{ message: string }>('initialization_error', ({ message }) =>
      set({ state: 'failed', reason: `This browser can't play Spotify (${message}).`, action: 'none' }),
    );
    on<{ message: string }>('authentication_error', () =>
      set({ state: 'failed', reason: 'Spotify rejected the login for this window.', action: 'relogin' }),
    );
    on<{ message: string }>('account_error', () => set({ state: 'failed', reason: 'Spotify Premium required.', action: 'none' }));
    on<{ message: string }>('playback_error', ({ message }) => log('device', `This browser: playback error (${message})`));
    on('autoplay_failed', () => {
      log('device', 'This browser: autoplay blocked');
      autoplayBlocked = true;
      notify();
    });
    on<SdkState | null>('player_state_changed', (state) => {
      if (state && !state.paused && autoplayBlocked) {
        autoplayBlocked = false;
        notify();
      }
    });
    player = p;
  }

  /** The recovery ladder (spec §12.2): reconnect; else rebuild; else ask for a reload. */
  function recover(why: string): Promise<void> {
    if (status.state === 'off' || !sdk) return Promise.resolve();
    if (!recovering) {
      recovering = (async () => {
        log('device', `This browser: recovering (${why})`);
        set({ state: 'recovering' });
        // 1. Reconnect the existing player.
        const ready1 = nextReady(READY_TIMEOUT_MS);
        await player?.connect().catch(() => false);
        if (deviceId && (await isListed(deviceId))) {
          readyResolve?.(deviceId);
          set({ state: 'ready', deviceId });
          return;
        }
        const id1 = await ready1;
        if (id1) {
          await ensureRegistered(id1);
          if (current().state === 'ready') return;
        }
        // 2. Throw it away and build a new one.
        player?.disconnect();
        deviceId = null;
        const ready2 = nextReady(REBUILD_READY_TIMEOUT_MS);
        build();
        await player!.connect().catch(() => false);
        const id2 = await ready2;
        if (id2) {
          await ensureRegistered(id2);
          if (current().state === 'ready') return;
        }
        // 3. Give up visibly.
        set({ state: 'failed', reason: 'The in-browser player stopped responding.', action: 'reload' });
      })().finally(() => {
        recovering = null;
      });
    }
    return recovering;
  }

  /** Run recovery ahead of the next press, not during it (spec §12.2 proactive triggers). */
  async function healthCheck(why: string) {
    if (status.state === 'ready' && !(await isListed(status.deviceId))) void recover(why);
    else if (status.state === 'waiting' && deviceId) void ensureRegistered(deviceId);
  }

  function installWakeDetection() {
    const onVisible = () => document.visibilityState === 'visible' && void healthCheck('window visible again');
    const onOnline = () => void healthCheck('back online');
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      if (now - last > DRIFT_WAKE_MS) void healthCheck('wake from sleep detected');
      last = now;
    }, DRIFT_TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }

  async function start(): Promise<void> {
    if (status.state !== 'off') return;
    set({ state: 'loading' });
    try {
      sdk ??= await deps.loadSdk();
    } catch {
      set({ state: 'failed', reason: 'Spotify player blocked. Allow sdk.scdn.co (ad blocker?), then reload.', action: 'allow' });
      return;
    }
    if (current().state !== 'loading') return; // stopped meanwhile
    set({ state: 'connecting' });
    if (typeof document !== 'undefined') teardown = installWakeDetection();
    const first = nextReady(FIRST_CONNECT_TIMEOUT_MS);
    build();
    await player!.connect().catch(() => false);
    if (!(await first) && current().state === 'connecting') void recover('no ready event after connect');
  }

  function stop(reason: OffReason = 'not-started') {
    generation++;
    player?.disconnect();
    player = null;
    deviceId = null;
    autoplayBlocked = false;
    teardown?.();
    teardown = null;
    set({ state: 'off', reason });
  }

  function waitReady(signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const done = () => {
        listeners.delete(check);
        signal.removeEventListener('abort', onAbort);
      };
      const check = () => {
        if (status.state === 'ready') {
          done();
          resolve(status.deviceId);
        } else if (status.state === 'failed') {
          done();
          reject(new SdkUnavailableError(status.reason));
        } else if (status.state === 'off') {
          done();
          reject(new SdkUnavailableError(offMessage(status.reason)));
        }
      };
      const onAbort = () => {
        done();
        reject(signal.reason);
      };
      if (signal.aborted) return onAbort();
      listeners.add(check);
      signal.addEventListener('abort', onAbort, { once: true });
      check();
    });
  }

  /** A usable, registered device ID, recovering first if needed. `fresh` re-checks /devices. */
  async function ensureReady(signal: AbortSignal, fresh = false): Promise<string> {
    if (status.state === 'off') throw new SdkUnavailableError(offMessage(status.reason));
    if (status.state === 'failed') {
      if (status.action !== 'reload') throw new SdkUnavailableError(status.reason);
      void recover('press after failure');
    } else if (status.state === 'ready' && fresh) {
      if (!(await raceAbort(isListed(status.deviceId), signal))) void recover('not listed when pressed');
    } else if (status.state === 'waiting' && deviceId) {
      void ensureRegistered(deviceId);
    }
    return waitReady(signal);
  }

  async function observe(): Promise<Observation | null> {
    const s = await player?.getCurrentState();
    if (!s || !deviceId) return null;
    const track = s.track_window.current_track;
    const uri = s.context?.uri ?? null;
    const m = uri ? /playlist:([A-Za-z0-9]+)$/.exec(uri) : null;
    return {
      deviceId,
      deviceName: 'This browser',
      playlistId: m ? m[1] : null,
      isPlaying: !s.paused,
      progressMs: s.position,
      trackId: track?.id ?? null,
      shuffle: s.shuffle,
      repeat: s.repeat_mode === 1 ? 'context' : s.repeat_mode === 2 ? 'track' : 'off',
    };
  }

  return {
    start,
    stop,
    /** Mark off without starting (no streaming scope yet, or another tab owns the player). */
    setOff: (reason: OffReason) => stop(reason),
    recover: (signal?: AbortSignal) => (signal ? raceAbort(recover('re-register requested'), signal) : recover('requested')),
    ensureReady,
    observe,
    /** Must run synchronously inside the click handler (browser autoplay policy). */
    activate() {
      try {
        void player?.activateElement().catch(() => {});
      } catch {
        /* no player yet */
      }
    },
    /** The "Click to enable audio" button. */
    async enableAudio() {
      await player?.activateElement().catch(() => {});
      await player?.resume().catch(() => {});
    },
    /** Debug panel: make the player die silently, as it does after sleep. */
    kill() {
      log('device', 'debug: killing the in-browser player');
      player?.disconnect();
    },
    getStatus: () => status,
    isAutoplayBlocked: () => autoplayBlocked,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type WebPlayback = ReturnType<typeof createWebPlayback>;

/** Inject Spotify's SDK script once. */
export function loadSpotifySdk(): Promise<SdkNamespace> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Spotify?: SdkNamespace; onSpotifyWebPlaybackSDKReady?: () => void };
    if (w.Spotify?.Player) return resolve(w.Spotify);
    w.onSpotifyWebPlaybackSDKReady = () => resolve(w.Spotify!);
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('blocked'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('timeout')), 15_000);
  });
}

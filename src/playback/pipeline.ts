// The play pipeline (spec §12.3–12.4). A press ends in one of two visible states:
// Playing (observed, not assumed) or Failed with a reason. Any 2xx means "accepted".

import { ReloginError } from '../auth/auth';
import { log } from '../diagnostics/log';
import * as api from '../spotify/api';
import { SpotifyError } from '../spotify/client';
import type { PlaybackState } from '../spotify/types';
import { parsePlaylistId, playlistUri } from '../spotify/uri';
import { raceAbort, sleep } from '../sleep';
import { read } from '../storage';
import { matchDevice, type DevicePref, type DeviceStore } from './devices';

export const DEADLINE_MS = 12_000;
export const CONFIRM_WINDOW_MS = 5_000;
/** Delay before each confirmation poll; the last value repeats. */
export const POLL_DELAYS_MS = [500, 1000, 1000, 1000, 1500];
/** Backoff before each retry of a 404/502/503 on the play command. */
export const RETRY_DELAYS_MS = [250, 750];
export const WAKE_SETTLE_MS = 1_000;
export const LATE_WATCH_MS = 10_000;
export const LATE_POLL_MS = 2_000;
/** Soft transitions (Milestone 3): fade out, switch, fade in. */
export const FADE_OUT_MS = 1_200;
export const FADE_IN_MS = 1_500;

// ---------- the device interface (1b adds an SDK implementation) ----------

export interface Observation {
  deviceId: string | null;
  deviceName: string | null;
  playlistId: string | null;
  isPlaying: boolean;
  progressMs: number | null;
  trackId: string | null;
  shuffle: boolean;
  repeat: 'off' | 'track' | 'context';
  /** 0–100, or null if the device doesn't report or support volume. */
  volume: number | null;
}

export interface PlayerDevice {
  readonly label: string;
  /** Step 1: called synchronously in the click handler, before any await (SDK autoplay). */
  prepareGesture?(): void;
  /** Step 3: a usable device ID. `fresh` forces a new device list. Throws DeviceMissingError. */
  resolve(signal: AbortSignal, fresh?: boolean): Promise<string>;
  /** Step 4: send the play command once (no retries). Throws SpotifyError. */
  sendPlay(id: string, req: api.PlayRequest, signal: AbortSignal): Promise<void>;
  sendResume(id: string, signal: AbortSignal): Promise<void>;
  sendPause(id: string, signal: AbortSignal): Promise<void>;
  sendNext(id: string, signal: AbortSignal): Promise<void>;
  /** Step 5: what the player is doing now. null means nothing is active. */
  observe(signal: AbortSignal): Promise<Observation | null>;
  /** Step 6: make the device active again before the single re-send. */
  wake(id: string, signal: AbortSignal): Promise<void>;
  setShuffle(id: string, on: boolean, signal: AbortSignal): Promise<void>;
  setRepeatContext(id: string, signal: AbortSignal): Promise<void>;
  /** For soft transitions. Absent: the device switches with a hard cut. */
  setVolume?(id: string, percent: number, signal: AbortSignal): Promise<void>;
  /** How many volume steps a fade uses: few for remote devices (rate-limited), many locally. */
  readonly fadeSteps?: number;
}

export class DeviceMissingError extends Error {
  constructor(readonly label: string) {
    super(`Spotify isn't open on ${label}. Open it, then press again.`);
    this.name = 'DeviceMissingError';
  }
}

export function toObservation(s: PlaybackState | null): Observation | null {
  if (!s) return null;
  return {
    deviceId: s.device?.id ?? null,
    deviceName: s.device?.name ?? null,
    playlistId: parsePlaylistId(s.context?.uri),
    isPlaying: s.is_playing,
    progressMs: s.progress_ms,
    trackId: s.item?.id ?? null,
    shuffle: s.shuffle_state,
    repeat: s.repeat_state,
    volume: s.device?.volume_percent ?? null,
  };
}

/** A Spotify Connect device (the desktop app, a phone…), controlled through the Web API. */
export function createRemoteDevice(pref: DevicePref, store: DeviceStore): PlayerDevice {
  return {
    label: pref.name,
    async resolve(signal, fresh = false) {
      let found = matchDevice(fresh ? await store.refresh(signal) : await store.get(undefined, signal), pref);
      if (!found && !fresh) found = matchDevice(await store.refresh(signal), pref); // one refresh (US-4)
      if (!found) throw new DeviceMissingError(pref.name);
      return found.id;
    },
    sendPlay: (id, req, signal) => api.play(id, req, { signal, retry5xx: false }),
    sendResume: (id, signal) => api.resume(id, { signal, retry5xx: false }),
    sendPause: (id, signal) => api.pause(id, { signal }),
    sendNext: (id, signal) => api.next(id, { signal }),
    observe: async (signal) => toObservation(await api.getPlaybackState({ signal })),
    wake: (id, signal) => api.transfer(id, { signal }),
    setShuffle: (id, on, signal) => api.setShuffle(id, on, { signal }),
    setRepeatContext: (id, signal) => api.setRepeat(id, 'context', { signal }),
    setVolume: (id, percent, signal) => api.setVolume(id, percent, { signal }),
    fadeSteps: 3,
  };
}

/**
 * Wrap a device so every call settles by the time its signal aborts. The deadline
 * must win even when a call waits on something that ignores the signal (D3).
 */
export function guardDevice(d: PlayerDevice): PlayerDevice {
  return {
    get label() {
      return d.label; // a fallback device changes label mid-press
    },
    prepareGesture: () => d.prepareGesture?.(),
    resolve: (signal, fresh) => raceAbort(d.resolve(signal, fresh), signal),
    sendPlay: (id, req, signal) => raceAbort(d.sendPlay(id, req, signal), signal),
    sendResume: (id, signal) => raceAbort(d.sendResume(id, signal), signal),
    sendPause: (id, signal) => raceAbort(d.sendPause(id, signal), signal),
    sendNext: (id, signal) => raceAbort(d.sendNext(id, signal), signal),
    observe: (signal) => raceAbort(d.observe(signal), signal),
    wake: (id, signal) => raceAbort(d.wake(id, signal), signal),
    setShuffle: (id, on, signal) => raceAbort(d.setShuffle(id, on, signal), signal),
    setRepeatContext: (id, signal) => raceAbort(d.setRepeatContext(id, signal), signal),
    setVolume: d.setVolume ? (id, percent, signal) => raceAbort(d.setVolume!(id, percent, signal), signal) : undefined,
    fadeSteps: d.fadeSteps,
  };
}

// ---------- state ----------

export type PressState =
  | { status: 'idle' }
  | { status: 'starting'; seq: number; playlistId: string; step: string }
  | { status: 'playing'; seq: number; playlistId: string; deviceLabel: string }
  | { status: 'paused'; seq: number; playlistId: string | null; deviceLabel: string }
  | {
      status: 'failed';
      seq: number;
      playlistId: string | null;
      reason: string;
      deviceMissing: boolean;
    };

export interface PlaylistRef {
  id: string;
  /** Track count, for the random start (D14). */
  total?: number;
}

class Superseded extends Error {}
class DeadlineExceeded extends Error {}

export interface PipelineOptions {
  random?: () => number;
  /** Read on every press, so the setting applies at once. */
  fadeEnabled?: () => boolean;
}

export function createPipeline(opts: PipelineOptions = {}) {
  const random = opts.random ?? Math.random;
  const fadeEnabled = opts.fadeEnabled ?? (() => false);
  /**
   * The volume to come back to, while a fade has the device quiet. Survives a superseding
   * press (it fades in to the same target), and every failure path restores it.
   */
  let transition: { deviceId: string; target: number; device: PlayerDevice } | null = null;
  let seq = 0;
  let controller: AbortController | null = null;
  let state: PressState = { status: 'idle' };
  const listeners = new Set<() => void>();

  function set(next: PressState) {
    state = next;
    listeners.forEach((fn) => fn());
  }

  /** Start a new run: supersede the old one and arm the overall deadline. */
  function begin() {
    controller?.abort(new Superseded());
    const mine = ++seq;
    const ctrl = new AbortController();
    controller = ctrl;
    const timer = setTimeout(() => ctrl.abort(new DeadlineExceeded()), DEADLINE_MS);
    const deadline = Date.now() + DEADLINE_MS;
    return {
      mine,
      signal: ctrl.signal,
      deadline,
      current: () => mine === seq,
      done: () => clearTimeout(timer),
    };
  }

  /** Poll until our playlist is observed playing *and* advancing, or `until` passes. */
  async function confirm(
    device: PlayerDevice,
    id: string,
    playlistId: string | null,
    until: number,
    signal: AbortSignal,
    pollEveryMs?: number,
  ): Promise<{ ok: true; obs: Observation } | { ok: false; last: Observation | null | undefined }> {
    const matches = (o: Observation | null | undefined): o is Observation =>
      !!o && o.deviceId === id && o.isPlaying && (playlistId === null || o.playlistId === playlistId);
    let prev: Observation | null = null;
    let last: Observation | null | undefined;
    for (let i = 0; ; i++) {
      const delay = pollEveryMs ?? POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)];
      if (Date.now() + delay > until) return { ok: false, last };
      await sleep(delay, signal);
      let obs: Observation | null;
      try {
        obs = await device.observe(signal);
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        log('pipeline', `observe failed: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      last = obs;
      if (matches(obs) && matches(prev)) {
        const advanced = obs.trackId !== prev.trackId || (obs.progressMs ?? 0) > (prev.progressMs ?? 0);
        if (advanced) return { ok: true, obs };
      }
      prev = obs;
    }
  }

  async function ramp(device: PlayerDevice, id: string, from: number, to: number, ms: number, signal: AbortSignal) {
    const steps = Math.max(1, device.fadeSteps ?? 3);
    for (let i = 1; i <= steps; i++) {
      await device.setVolume!(id, from + ((to - from) * i) / steps, signal);
      if (i < steps) await sleep(ms / steps, signal);
    }
  }

  /** Put the volume back now (failure, pause, next). Fire-and-forget with its own timeout. */
  function restoreVolume(why: string) {
    const t = transition;
    transition = null;
    if (!t?.device.setVolume) return;
    log('pipeline', `restoring volume to ${t.target} (${why})`);
    void t.device.setVolume(t.deviceId, t.target, AbortSignal.timeout(DEADLINE_MS)).catch((e: unknown) =>
      log('pipeline', `could not restore volume: ${e instanceof Error ? e.message : e}`),
    );
  }

  /** Before switching: fade out whatever is playing on this device. */
  async function fadeOut(device: PlayerDevice, id: string, run: ReturnType<typeof begin>, step: (s: string) => void) {
    if (!fadeEnabled() || !device.setVolume) return;
    const before = await device.observe(run.signal).catch(() => null);
    const here = before && before.deviceId === id ? before : null;
    const target = transition?.deviceId === id ? transition.target : here?.volume ?? null;
    if (target === null || target <= 0) return;
    transition = { deviceId: id, target, device };
    if (!here?.isPlaying || here.volume === null || here.volume <= 0) return; // already quiet
    step('Fading out…');
    await ramp(device, id, here.volume, 0, FADE_OUT_MS, run.signal);
  }

  /** After confirmation: fade back up to the volume before the switch. */
  async function fadeIn(device: PlayerDevice, id: string, signal: AbortSignal) {
    const t = transition;
    if (!t || t.deviceId !== id || !device.setVolume) return;
    await ramp(device, id, 0, t.target, FADE_IN_MS, signal);
    // Spotify doesn't promise command order: assert the final volume once more.
    await device.setVolume(id, t.target, signal);
    if (transition === t) transition = null;
  }

  /** Step 8 (D14, D15): shuffle on, repeat the playlist. Only after confirmation. */
  async function ensureMode(device: PlayerDevice, id: string, obs: Observation, signal: AbortSignal) {
    try {
      if (!obs.shuffle) await device.setShuffle(id, true, signal);
      if (obs.repeat !== 'context') await device.setRepeatContext(id, signal);
    } catch (e) {
      log('pipeline', `could not set shuffle/repeat: ${e instanceof Error ? e.message : e}`);
    }
  }

  function unconfirmedReason(label: string, playlistId: string | null, id: string, last: Observation | null | undefined) {
    if (!last) return `Spotify accepted the command, but nothing is playing on ${label}.`;
    if (last.deviceId !== id) return `Spotify is playing on ${last.deviceName ?? 'another device'} instead of ${label}.`;
    if (playlistId && last.playlistId !== playlistId) return `Spotify is playing something else on ${label}.`;
    if (!last.isPlaying) return `The playlist loaded on ${label} but is paused.`;
    return `Spotify loaded the playlist on ${label} but it hasn't started.`;
  }

  function failureReason(e: unknown, label: string): { reason: string; deviceMissing: boolean } {
    if (e instanceof DeviceMissingError) return { reason: e.message, deviceMissing: true };
    if (e instanceof DeadlineExceeded) {
      return { reason: `Spotify didn't respond within ${DEADLINE_MS / 1000} s.`, deviceMissing: false };
    }
    if (e instanceof ReloginError) return { reason: 'Log in again.', deviceMissing: false };
    if (e instanceof SpotifyError && e.kind === 'not-found') {
      return { reason: `Spotify couldn't reach ${label}. Open Spotify there, then press again.`, deviceMissing: true };
    }
    if (e instanceof Error) return { reason: e.message, deviceMissing: false };
    return { reason: String(e), deviceMissing: false };
  }

  /** Keep watching after a failure; if playback shows up, flip to Playing (spec §12.3). */
  function lateWatch(run: ReturnType<typeof begin>, device: PlayerDevice, id: string, playlistId: string | null) {
    const ctrl = new AbortController();
    const stop = () => ctrl.abort(new Superseded());
    const unsubscribe = subscribe(() => {
      if (!run.current()) stop();
    });
    void (async () => {
      try {
        const result = await confirm(device, id, playlistId, Date.now() + LATE_WATCH_MS, ctrl.signal, LATE_POLL_MS);
        if (result.ok && run.current()) {
          log('pipeline', `#${run.mine} late confirmation: playing`);
          set({ status: 'playing', seq: run.mine, playlistId: playlistId ?? '', deviceLabel: device.label });
          await ensureMode(device, id, result.obs, ctrl.signal);
        }
      } catch {
        /* superseded */
      } finally {
        unsubscribe();
      }
    })();
  }

  async function sendWithRetry(
    device: PlayerDevice,
    id: string,
    req: api.PlayRequest,
    run: ReturnType<typeof begin>,
    step: (s: string) => void,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        await device.sendPlay(id, req, run.signal);
        return id;
      } catch (e) {
        const retryable = e instanceof SpotifyError && [404, 502, 503].includes(e.status);
        if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw e;
        step('Retrying…');
        await sleep(RETRY_DELAYS_MS[attempt], run.signal);
        // The device may have restarted with a new ID (US-4): look it up again.
        if (e.status === 404) id = await device.resolve(run.signal, true);
      }
    }
  }

  /** Press a playlist. Resolves with the final state of this press (for the Ready check). */
  async function press(playlist: PlaylistRef, rawDevice: PlayerDevice): Promise<PressState> {
    rawDevice.prepareGesture?.(); // before any await
    const run = begin();
    const device = guardDevice(rawDevice);
    const playlistId = playlist.id;
    const step = (s: string) => {
      if (!run.current()) return;
      log('pipeline', `#${run.mine} ${s}`);
      set({ status: 'starting', seq: run.mine, playlistId, step: s });
    };
    let accepted = false;
    let id: string | null = null;
    try {
      step('Finding device…');
      id = await device.resolve(run.signal);
      await fadeOut(device, id, run, step);

      const offsetPosition =
        playlist.total && playlist.total > 0 ? Math.floor(random() * playlist.total) : undefined;
      const req = { contextUri: playlistUri(playlistId), offsetPosition };
      step(offsetPosition === undefined ? 'Starting…' : `Starting at track ${offsetPosition + 1}…`);
      id = await sendWithRetry(device, id, req, run, step);
      accepted = true;

      step('Confirming…');
      let result = await confirm(device, id, playlistId, Math.min(run.deadline, Date.now() + CONFIRM_WINDOW_MS), run.signal);

      if (!result.ok) {
        const last = result.last;
        const oursButStalled = !!last && last.deviceId === id && last.playlistId === playlistId;
        if (oursButStalled) {
          // Re-sending would restart it. Keep waiting until the deadline.
          step('Waiting for Spotify…');
        } else {
          step('Waking Spotify…');
          await device.wake(id, run.signal);
          await sleep(WAKE_SETTLE_MS, run.signal);
          step('Starting again…');
          await device.sendPlay(id, req, run.signal); // at most one re-send per press
          step('Confirming…');
        }
        result = await confirm(device, id, playlistId, run.deadline - 100, run.signal);
      }

      if (!run.current()) return state;
      if (result.ok) {
        log('pipeline', `#${run.mine} playing`);
        set({ status: 'playing', seq: run.mine, playlistId, deviceLabel: device.label });
        await fadeIn(device, id, run.signal).catch((e: unknown) => {
          if (run.signal.aborted) throw e;
          restoreVolume('fade-in failed');
        });
        await ensureMode(device, id, result.obs, run.signal);
        return state;
      }
      const reason = unconfirmedReason(device.label, playlistId, id, result.last);
      restoreVolume('press failed');
      log('pipeline', `#${run.mine} failed: ${reason}`);
      set({ status: 'failed', seq: run.mine, playlistId, reason, deviceMissing: false });
      lateWatch(run, device, id, playlistId);
      return state;
    } catch (e) {
      const cause = run.signal.aborted ? run.signal.reason : e;
      if (cause instanceof Superseded || !run.current()) return state; // the next press owns the fade
      restoreVolume('press failed');
      const { reason, deviceMissing } = failureReason(cause, device.label);
      log('pipeline', `#${run.mine} failed: ${reason}`);
      set({ status: 'failed', seq: run.mine, playlistId, reason, deviceMissing });
      if (accepted && id) lateWatch(run, device, id, playlistId);
      return state;
    } finally {
      run.done();
    }
  }

  /** The playlist the current state refers to, if any. */
  function currentPlaylistId(): string | null {
    return state.status === 'idle' ? null : state.playlistId;
  }

  async function pause(rawDevice: PlayerDevice): Promise<PressState> {
    const run = begin();
    restoreVolume('paused mid-fade');
    const device = guardDevice(rawDevice);
    const playlistId = currentPlaylistId();
    try {
      const id = await device.resolve(run.signal);
      try {
        await device.sendPause(id, run.signal);
      } catch (e) {
        // Already paused: Spotify says "Restriction violated". Re-read state, stay quiet.
        if (!(e instanceof SpotifyError && e.kind === 'restriction')) throw e;
        const obs = await device.observe(run.signal);
        if (obs?.isPlaying) throw e;
      }
      if (run.current()) set({ status: 'paused', seq: run.mine, playlistId, deviceLabel: device.label });
    } catch (e) {
      const cause = run.signal.aborted ? run.signal.reason : e;
      if (!(cause instanceof Superseded) && run.current()) {
        set({ status: 'failed', seq: run.mine, playlistId, ...failureReason(cause, device.label) });
      }
    } finally {
      run.done();
    }
    return state;
  }

  /** Resume is confirmed the same way as a press: observed playing and advancing. */
  async function resume(rawDevice: PlayerDevice): Promise<PressState> {
    rawDevice.prepareGesture?.();
    const run = begin();
    restoreVolume('resumed mid-fade');
    const device = guardDevice(rawDevice);
    const playlistId = currentPlaylistId();
    try {
      set({ status: 'starting', seq: run.mine, playlistId: playlistId ?? '', step: 'Resuming…' });
      const id = await device.resolve(run.signal);
      try {
        await device.sendResume(id, run.signal);
      } catch (e) {
        if (!(e instanceof SpotifyError && e.kind === 'restriction')) throw e; // already playing
      }
      const result = await confirm(device, id, playlistId, run.deadline - 100, run.signal);
      if (!run.current()) return state;
      if (result.ok) {
        set({ status: 'playing', seq: run.mine, playlistId: result.obs.playlistId ?? playlistId ?? '', deviceLabel: device.label });
      } else {
        set({
          status: 'failed',
          seq: run.mine,
          playlistId,
          reason: unconfirmedReason(device.label, playlistId, id, result.last),
          deviceMissing: false,
        });
      }
    } catch (e) {
      const cause = run.signal.aborted ? run.signal.reason : e;
      if (!(cause instanceof Superseded) && run.current()) {
        set({ status: 'failed', seq: run.mine, playlistId, ...failureReason(cause, device.label) });
      }
    } finally {
      run.done();
    }
    return state;
  }

  /**
   * Skip to the next track. Doesn't touch the press state or supersede a press.
   * Resolves with an error message, or null on success.
   */
  async function next(rawDevice: PlayerDevice): Promise<string | null> {
    const device = guardDevice(rawDevice);
    restoreVolume('skipped mid-fade');
    const signal = AbortSignal.timeout(DEADLINE_MS);
    try {
      await device.sendNext(await device.resolve(signal), signal);
      return null;
    } catch (e) {
      const cause = signal.aborted ? new DeadlineExceeded() : e;
      return failureReason(cause, device.label).reason;
    }
  }

  function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  return {
    press,
    pause,
    resume,
    next,
    getState: () => state,
    subscribe,
    /** Drop any run in progress (logout). */
    reset() {
      restoreVolume('reset');
      controller?.abort(new Superseded());
      seq++;
      set({ status: 'idle' });
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;

export const FADE_PREF = 'prefs.fade';

export const pipeline = createPipeline({ fadeEnabled: () => read<boolean>(FADE_PREF) ?? true });

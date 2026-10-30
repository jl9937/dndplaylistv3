// The play pipeline (spec §12.3–12.4). A press ends in one of two visible states:
// Playing (observed, not assumed) or Failed with a reason. Any 2xx means "accepted".

import { ReloginError } from '../auth/auth';
import { log } from '../diagnostics/log';
import * as api from '../spotify/api';
import { SpotifyError } from '../spotify/client';
import { playlistUri } from '../spotify/uri';
import { sleep } from '../sleep';
import { read } from '../storage';
import { DeviceMissingError, guardDevice, type Observation, type PlayerDevice } from './device';
import { createFader } from './fader';

export const DEADLINE_MS = 12_000;
export const CONFIRM_WINDOW_MS = 5_000;
/** Delay before each confirmation poll; the last value repeats. */
export const POLL_DELAYS_MS = [500, 1000, 1000, 1000, 1500];
/** Backoff before each retry of a 404/502/503 on the play command. */
export const RETRY_DELAYS_MS = [250, 750];
export const WAKE_SETTLE_MS = 1_000;
export const LATE_WATCH_MS = 10_000;
export const LATE_POLL_MS = 2_000;

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
  /**
   * Start at this track (its Spotify ID) instead of a random one: Studio's Play. By ID, not
   * position: positions shift whenever a track is removed. Shuffle still follows.
   */
  startTrack?: string;
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
  const fader = createFader(opts.fadeEnabled ?? (() => false));
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
    opts: {
      until: number;
      signal: AbortSignal;
      /** A fixed poll interval (the late watch); otherwise POLL_DELAYS_MS. */
      pollEveryMs?: number;
      /** Called once, the first time our playlist is seen on our device (even before it advances). */
      onOurs?: () => void;
    },
  ): Promise<{ ok: true; obs: Observation } | { ok: false; last: Observation | null | undefined }> {
    const matches = (o: Observation | null | undefined): o is Observation =>
      !!o && o.deviceId === id && o.isPlaying && (playlistId === null || o.playlistId === playlistId);
    const { until, signal, pollEveryMs } = opts;
    let onOurs = opts.onOurs;
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
      if (onOurs && obs && obs.deviceId === id && obs.playlistId === playlistId) {
        onOurs();
        onOurs = undefined;
      }
      if (matches(obs) && matches(prev)) {
        const advanced = obs.trackId !== prev.trackId || (obs.progressMs ?? 0) > (prev.progressMs ?? 0);
        if (advanced) return { ok: true, obs };
      }
      prev = obs;
    }
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

  /** Pause/Resume failure: show it, unless a newer run has taken over. */
  function failRun(run: ReturnType<typeof begin>, e: unknown, playlistId: string | null, label: string) {
    const cause = run.signal.aborted ? run.signal.reason : e;
    if (!(cause instanceof Superseded) && run.current()) {
      set({ status: 'failed', seq: run.mine, playlistId, ...failureReason(cause, label) });
    }
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
        const result = await confirm(device, id, playlistId, {
          until: Date.now() + LATE_WATCH_MS,
          signal: ctrl.signal,
          pollEveryMs: LATE_POLL_MS,
        });
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
  ): Promise<{ id: string; req: api.PlayRequest }> {
    for (let attempt = 0; ; attempt++) {
      try {
        await device.sendPlay(id, req, run.signal);
        return { id, req };
      } catch (e) {
        // A chosen track (Studio's Play) that Spotify refuses: say so, rather than quietly
        // playing a different one.
        if (e instanceof SpotifyError && e.kind === 'restriction' && req.offsetUri) {
          log('pipeline', `#${run.mine} refused to start at the chosen track`);
          throw new SpotifyError('restriction', e.status, 'Spotify won’t start at that track. It may be unavailable here.', e.spotifyMessage, e.reason);
        }
        // "Restriction violated" with a random start usually means that track can't play
        // (a local file, or unavailable here). Retry once from Spotify's own start, still shuffled.
        if (e instanceof SpotifyError && e.kind === 'restriction' && req.offsetPosition !== undefined) {
          log('pipeline', `#${run.mine} refused at track ${req.offsetPosition + 1}; retrying without a random start`);
          step('Retrying…');
          req = { contextUri: req.contextUri };
          continue;
        }
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
      await fader.fadeOut(device, id, run.signal, () => step('Fading out…'));

      const offsetPosition =
        !playlist.startTrack && playlist.total && playlist.total > 0 ? Math.floor(random() * playlist.total) : undefined;
      let req: api.PlayRequest = playlist.startTrack
        ? { contextUri: playlistUri(playlistId), offsetUri: `spotify:track:${playlist.startTrack}` }
        : { contextUri: playlistUri(playlistId), offsetPosition };
      step(playlist.startTrack ? 'Starting at the chosen track…' : offsetPosition === undefined ? 'Starting…' : `Starting at track ${offsetPosition + 1}…`);
      ({ id, req } = await sendWithRetry(device, id, req, run, step));
      accepted = true;

      step('Confirming…');
      // The new playlist comes in at full volume (no fade in). Restore only once it's *seen*:
      // Spotify's commands are unordered, and restoring earlier could blast the old track.
      const onOurs = () => run.current() && fader.active(id!) && fader.restore('new playlist started');
      let result = await confirm(device, id, playlistId, {
        until: Math.min(run.deadline, Date.now() + CONFIRM_WINDOW_MS),
        signal: run.signal,
        onOurs,
      });

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
        result = await confirm(device, id, playlistId, { until: run.deadline - 100, signal: run.signal, onOurs });
      }

      if (!run.current()) return state;
      if (result.ok) {
        log('pipeline', `#${run.mine} playing`);
        set({ status: 'playing', seq: run.mine, playlistId, deviceLabel: device.label });
        onOurs(); // in case confirmation came before any separate "ours" sighting
        await ensureMode(device, id, result.obs, run.signal);
        return state;
      }
      const reason = unconfirmedReason(device.label, playlistId, id, result.last);
      fader.restore('press failed');
      log('pipeline', `#${run.mine} failed: ${reason}`);
      set({ status: 'failed', seq: run.mine, playlistId, reason, deviceMissing: false });
      lateWatch(run, device, id, playlistId);
      return state;
    } catch (e) {
      const cause = run.signal.aborted ? run.signal.reason : e;
      if (cause instanceof Superseded || !run.current()) return state; // the next press owns the fade
      fader.restore('press failed');
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
    fader.restore('paused mid-fade');
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
      failRun(run, e, playlistId, device.label);
    } finally {
      run.done();
    }
    return state;
  }

  /** Resume is confirmed the same way as a press: observed playing and advancing. */
  async function resume(rawDevice: PlayerDevice): Promise<PressState> {
    rawDevice.prepareGesture?.();
    const run = begin();
    fader.restore('resumed mid-fade');
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
      const result = await confirm(device, id, playlistId, { until: run.deadline - 100, signal: run.signal });
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
      failRun(run, e, playlistId, device.label);
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
    // Next leaves any fade alone: the press in flight owns it, and restores the volume
    // when its new playlist is seen. (Restoring here let the fade carry on to 0.)
    const device = guardDevice(rawDevice);
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
      fader.restore('reset');
      controller?.abort(new Superseded());
      seq++;
      set({ status: 'idle' });
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;

export const FADE_PREF = 'prefs.fade';

export const pipeline = createPipeline({ fadeEnabled: () => read<boolean>(FADE_PREF) ?? true });

// The device interface the play pipeline drives (D16), and its Spotify Connect
// implementation. Milestone 1b adds "This browser" (player/sdkDevice.ts).

import * as api from '../spotify/api';
import type { PlaybackState } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';
import { raceAbort } from '../sleep';
import { matchDevice, type DevicePref, type DeviceStore } from './devices';

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
    fadeSteps: 5,
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

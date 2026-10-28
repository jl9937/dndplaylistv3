// The one entry point for playing, pausing and skipping (outside React, so it's testable).
// It turns the stored device choice into a pipeline device, adds the automatic fallback
// to "This browser" per press (US-1b-2), and routes Pause/Next to whatever is playing.

import { isBrowserPref } from '../player/sdkDevice';
import { SDK_PLAYER_NAME, type SdkStatus } from '../player/webPlayback';
import type { PlaybackState } from '../spotify/types';
import { createRemoteDevice, type PlayerDevice } from './device';
import type { DevicePref, DeviceStore } from './devices';
import { createFallbackDevice } from './fallback';
import type { Pipeline, PlaylistRef } from './pipeline';

export interface PlaybackDeps {
  pipeline: Pipeline;
  store: DeviceStore;
  /** "This browser" as a pipeline device. */
  browser: PlayerDevice;
  sdkStatus: () => SdkStatus;
  /** A message for the user, or null to clear it. */
  notify: (message: string | null) => void;
}

export function createPlayback(deps: PlaybackDeps) {
  /** The device for a stored choice, with no fallback (also used by the Ready check). */
  const deviceFor = (pref: DevicePref | null): PlayerDevice | null =>
    !pref ? null : isBrowserPref(pref) ? deps.browser : createRemoteDevice(pref, deps.store);

  const canFallBack = () => {
    const s = deps.sdkStatus();
    return s.state !== 'off' && !(s.state === 'failed' && s.action !== 'reload');
  };

  /** A new one per press, so the next press tries the chosen device again. */
  const pressDevice = (pref: DevicePref | null): PlayerDevice | null => {
    const device = deviceFor(pref);
    if (!device || device === deps.browser) return device;
    return createFallbackDevice(device, deps.browser, canFallBack, (label) =>
      deps.notify(`Spotify app not found on ${label}, so it's playing in this window.`),
    );
  };

  /** Pause and Next go to whatever is actually playing: this window after a fallback. */
  const controlDevice = (pref: DevicePref | null, now: PlaybackState | null | undefined): PlayerDevice | null => {
    const s = deps.sdkStatus();
    const sdkId = s.state === 'ready' ? s.deviceId : null;
    const playing = now?.device;
    if (playing && (playing.name === SDK_PLAYER_NAME || (sdkId !== null && playing.id === sdkId))) return deps.browser;
    return deviceFor(pref);
  };

  return {
    deviceFor,
    /** Must be called from the click or key handler (the SDK needs the gesture). False if no device is chosen. */
    play(playlist: PlaylistRef, pref: DevicePref | null): boolean {
      const device = pressDevice(pref);
      if (!device) return false;
      deps.notify(null);
      void deps.pipeline.press(playlist, device);
      return true;
    },
    togglePause(pref: DevicePref | null, now: PlaybackState | null | undefined): void {
      const device = controlDevice(pref, now);
      if (!device) return;
      void (now?.is_playing ? deps.pipeline.pause(device) : deps.pipeline.resume(device));
    },
    async next(pref: DevicePref | null, now: PlaybackState | null | undefined): Promise<void> {
      const device = controlDevice(pref, now);
      if (!device) return;
      deps.notify(await deps.pipeline.next(device));
    },
  };
}

export type Playback = ReturnType<typeof createPlayback>;

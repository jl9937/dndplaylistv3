// Soft transitions (D26): fade the old music out, then let the new playlist start at full
// volume. All fade state lives here, so every exit path goes through one `restore()`.

import { log } from '../diagnostics/log';
import { sleep } from '../sleep';
import type { PlayerDevice } from './device';

export const FADE_OUT_MS = 3_000;
const RESTORE_TIMEOUT_MS = 12_000;

interface Transition {
  deviceId: string;
  /** The volume before the fade: what we always come back to. */
  target: number;
  device: PlayerDevice;
}

export function createFader(enabled: () => boolean) {
  let transition: Transition | null = null;

  async function ramp(device: PlayerDevice, id: string, from: number, to: number, signal: AbortSignal) {
    const steps = Math.max(1, device.fadeSteps ?? 3);
    for (let i = 1; i <= steps; i++) {
      await device.setVolume!(id, from + ((to - from) * i) / steps, signal);
      if (i < steps) await sleep(FADE_OUT_MS / steps, signal);
    }
  }

  return {
    /**
     * Before a switch: fade out whatever plays on this device. A fade already in progress
     * (a superseded press) keeps its original target, so we never come back quieter.
     */
    async fadeOut(device: PlayerDevice, id: string, signal: AbortSignal, onFading: () => void): Promise<void> {
      if (!enabled() || !device.setVolume) return;
      const before = await device.observe(signal).catch(() => null);
      const here = before && before.deviceId === id ? before : null;
      const target = transition?.deviceId === id ? transition.target : (here?.volume ?? null);
      if (target === null || target <= 0) return;
      transition = { deviceId: id, target, device };
      if (!here?.isPlaying || here.volume === null || here.volume <= 0) return; // already quiet
      onFading();
      await ramp(device, id, here.volume, 0, signal);
    },

    /** Put the volume back now. Fire-and-forget with its own timeout. Safe to call any time. */
    restore(why: string): void {
      const t = transition;
      transition = null;
      if (!t?.device.setVolume) return;
      log('pipeline', `restoring volume to ${t.target} (${why})`);
      void t.device.setVolume(t.deviceId, t.target, AbortSignal.timeout(RESTORE_TIMEOUT_MS)).catch((e: unknown) =>
        log('pipeline', `could not restore volume: ${e instanceof Error ? e.message : e}`),
      );
    },

    /** Is a fade holding this device quiet? */
    active: (id: string) => transition?.deviceId === id,
  };
}


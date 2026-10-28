// Automatic fallback (US-1b-2): if the chosen Spotify app isn't listed, play in this
// window instead, with a notice. Only ever to "This browser", never to a phone.
// Make a new one per press, so the next press tries the chosen device again.

import { DeviceMissingError, type PlayerDevice } from './device';

export function createFallbackDevice(
  primary: PlayerDevice,
  browser: PlayerDevice,
  canFallBack: () => boolean,
  onFallBack: (missingLabel: string) => void,
): PlayerDevice {
  let active = primary;
  return {
    get label() {
      return active.label;
    },
    // Activate the SDK too: we may fall back to it after the first await.
    prepareGesture: () => {
      primary.prepareGesture?.();
      browser.prepareGesture?.();
    },
    async resolve(signal, fresh) {
      if (active === browser) return browser.resolve(signal, fresh);
      try {
        return await primary.resolve(signal, fresh);
      } catch (e) {
        if (!(e instanceof DeviceMissingError) || !canFallBack()) throw e;
        active = browser;
        onFallBack(primary.label);
        return browser.resolve(signal, fresh);
      }
    },
    sendPlay: (...a) => active.sendPlay(...a),
    sendResume: (...a) => active.sendResume(...a),
    sendPause: (...a) => active.sendPause(...a),
    sendNext: (...a) => active.sendNext(...a),
    observe: (...a) => active.observe(...a),
    wake: (...a) => active.wake(...a),
    setShuffle: (...a) => active.setShuffle(...a),
    setRepeatContext: (...a) => active.setRepeatContext(...a),
    // Soft transitions: only if the active device supports volume control.
    get setVolume() {
      const d = active;
      return d.setVolume ? (id: string, percent: number, signal: AbortSignal) => d.setVolume!(id, percent, signal) : undefined;
    },
    get fadeSteps() {
      return active.fadeSteps;
    },
  };
}

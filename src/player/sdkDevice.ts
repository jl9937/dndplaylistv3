// "This browser" as a pipeline device (Milestone 1b). Commands still go through the Web
// API with our device_id; confirmation reads the SDK's own state, which is faster.

import type { PlayerDevice } from '../playback/device';
import * as api from '../spotify/api';
import type { WebPlayback } from './webPlayback';

export const BROWSER_LABEL = 'This browser';
/** The stored device choice for "This browser". */
export const BROWSER_PREF = { name: BROWSER_LABEL, type: 'browser' } as const;

export const isBrowserPref = (p: { type: string } | null): boolean => p?.type === BROWSER_PREF.type;

export function createSdkDevice(wp: WebPlayback): PlayerDevice {
  return {
    label: BROWSER_LABEL,
    prepareGesture: () => wp.activate(),
    // A 404 retry passes fresh=true: re-check /devices and re-register if we've vanished.
    resolve: (signal, fresh) => wp.ensureReady(signal, fresh),
    sendPlay: (id, req, signal) => api.play(id, req, { signal, retry5xx: false }),
    sendResume: (id, signal) => api.resume(id, { signal, retry5xx: false }),
    sendPause: (id, signal) => api.pause(id, { signal }),
    sendNext: (id, signal) => api.next(id, { signal }),
    observe: () => wp.observe(),
    // Step 6 for the SDK: re-register, then the pipeline re-sends once.
    wake: (_id, signal) => wp.recover(signal),
    setShuffle: (id, on, signal) => api.setShuffle(id, on, { signal }),
    setRepeatContext: (id, signal) => api.setRepeat(id, 'context', { signal }),
    setVolume: (_id, percent) => wp.setVolume(percent),
    fadeSteps: 12,
  };
}

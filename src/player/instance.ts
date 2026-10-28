// Single instance (US-1b-5): only one tab or window runs the SDK player, or Spotify sees
// two devices with the same name. Web Locks: the holder keeps a lock for the page's life;
// "Use this tab instead" steals it, and the old holder is told it lost.

import { getAccessToken, hasScope } from '../auth/auth';
import { log } from '../diagnostics/log';
import { deviceStore } from '../playback/devices';
import { createWebPlayback, loadSpotifySdk } from './webPlayback';

const LOCK = 'dnd-sdk-player';

export const webPlayback = createWebPlayback({
  loadSdk: loadSpotifySdk,
  listDeviceIds: async () => (await deviceStore.refresh()).map((d) => d.id),
  getToken: getAccessToken,
});

type Claim = 'primary' | 'secondary';
let claim: Promise<Claim> | null = null;

function request(steal: boolean): Promise<Claim> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve('primary');
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve('secondary');
          return undefined;
        }
        resolve('primary');
        return new Promise<void>(() => {}); // hold until the page goes away or it's stolen
      })
      .catch(() => {
        // Stolen by another tab.
        log('device', 'This browser: another tab took over the player');
        claim = Promise.resolve('secondary');
        webPlayback.stop('other-tab');
      });
  });
}

/** Start the player if this tab may run it. Safe to call repeatedly (StrictMode, re-login). */
export async function bootPlayer(): Promise<void> {
  if (!hasScope('streaming')) {
    webPlayback.setOff('needs-scope');
    return;
  }
  claim ??= request(false);
  if ((await claim) === 'primary') void webPlayback.start();
  else webPlayback.setOff('other-tab');
}

/** "Use this tab instead". */
export async function takeOverPlayer(): Promise<void> {
  claim = request(true);
  await claim;
  webPlayback.stop('not-started');
  void webPlayback.start();
}

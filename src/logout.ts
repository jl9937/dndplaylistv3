// Logging out stops everything that holds the session, then clears auth (spec §12.5).

import { logout } from './auth/auth';
import { resetLibrary } from './library/libraryStore';
import { deviceStore } from './playback/devices';
import { pipeline } from './playback/pipeline';
import { webPlayback } from './player/instance';

export function logoutEverything(): void {
  webPlayback.stop();
  pipeline.reset();
  deviceStore.clear();
  resetLibrary();
  logout();
}

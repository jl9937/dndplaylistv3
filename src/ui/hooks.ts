import { useSyncExternalStore } from 'react';
import { getAuthStatus, subscribeAuth } from '../auth/auth';
import { getLog, subscribeLog } from '../diagnostics/log';
import { getLibrary, subscribeLibrary } from '../library/libraryStore';
import { deviceStore } from '../playback/devices';
import { getNowPlaying, subscribeNowPlaying } from '../playback/nowPlaying';
import { pipeline } from '../playback/pipeline';
import { webPlayback } from '../player/instance';
import { getSets, subscribeSets } from '../sets/setsStore';

export const useAuthStatus = () => useSyncExternalStore(subscribeAuth, getAuthStatus);
export const usePressState = () => useSyncExternalStore(pipeline.subscribe, pipeline.getState);
export const useDevices = () => useSyncExternalStore(deviceStore.subscribe, deviceStore.getSnapshot);
export const useLog = () => useSyncExternalStore(subscribeLog, getLog);
export const useLibrary = () => useSyncExternalStore(subscribeLibrary, getLibrary);
export const useSets = () => useSyncExternalStore(subscribeSets, getSets);
export const useNowPlaying = () => useSyncExternalStore(subscribeNowPlaying, getNowPlaying);
export const useSdkStatus = () => useSyncExternalStore(webPlayback.subscribe, webPlayback.getStatus);
export const useAutoplayBlocked = () => useSyncExternalStore(webPlayback.subscribe, webPlayback.isAutoplayBlocked);

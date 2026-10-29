import { useState, useSyncExternalStore } from 'react';
import { ambience } from '../ambience/instance';
import { getAuthStatus, subscribeAuth } from '../auth/auth';
import { getLog, subscribeLog } from '../diagnostics/log';
import { getLibrary, subscribeLibrary } from '../library/libraryStore';
import { deviceStore } from '../playback/devices';
import { getNowPlaying, subscribeNowPlaying } from '../playback/nowPlaying';
import { pipeline } from '../playback/pipeline';
import { webPlayback } from '../player/instance';
import { getBoard, subscribeBoard } from '../board/boardStore';
import { read, write, type StorageKey } from '../storage';

export const useAuthStatus = () => useSyncExternalStore(subscribeAuth, getAuthStatus);
export const usePressState = () => useSyncExternalStore(pipeline.subscribe, pipeline.getState);
export const useDevices = () => useSyncExternalStore(deviceStore.subscribe, deviceStore.getSnapshot);
export const useLog = () => useSyncExternalStore(subscribeLog, getLog);
export const useLibrary = () => useSyncExternalStore(subscribeLibrary, getLibrary);
export const useBoard = () => useSyncExternalStore(subscribeBoard, getBoard);

/** A preference saved in localStorage (`prefs.*`). */
export function usePref<T>(key: StorageKey, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read<T>(key) ?? fallback);
  return [
    value,
    (next: T) => {
      write(key, next);
      setValue(next);
    },
  ];
}
export const useNowPlaying = () => useSyncExternalStore(subscribeNowPlaying, getNowPlaying);
export const useSdkStatus = () => useSyncExternalStore(webPlayback.subscribe, webPlayback.getStatus);
export const useAutoplayBlocked = () => useSyncExternalStore(webPlayback.subscribe, webPlayback.isAutoplayBlocked);
export const useAmbience = () => useSyncExternalStore(ambience.subscribe, ambience.getState);

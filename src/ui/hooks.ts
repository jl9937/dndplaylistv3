import { useSyncExternalStore } from 'react';
import { getAuthStatus, subscribeAuth } from '../auth/auth';
import { getLog, subscribeLog } from '../diagnostics/log';
import { deviceStore } from '../playback/devices';
import { pipeline } from '../playback/pipeline';

export const useAuthStatus = () => useSyncExternalStore(subscribeAuth, getAuthStatus);
export const usePressState = () => useSyncExternalStore(pipeline.subscribe, pipeline.getState);
export const useDevices = () => useSyncExternalStore(deviceStore.subscribe, deviceStore.getSnapshot);
export const useLog = () => useSyncExternalStore(subscribeLog, getLog);

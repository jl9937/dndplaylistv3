// Device list cache and the stored device choice (US-4). The choice is stored as
// {name, type}, never by ID: Spotify Connect IDs can change when the app restarts.

import { log } from '../diagnostics/log';
import { getDevices } from '../spotify/api';
import type { Device } from '../spotify/types';
import { read, write } from '../storage';

export interface DevicePref {
  name: string;
  type: string;
}

const PREF_KEY = 'prefs.device';
export const DEVICE_CACHE_MS = 30_000;

export function loadDevicePref(): DevicePref | null {
  return read<DevicePref>(PREF_KEY);
}

export function saveDevicePref(pref: DevicePref): void {
  write(PREF_KEY, { name: pref.name, type: pref.type });
  log('device', `device choice saved: ${pref.name} (${pref.type})`);
}

export function isUsable(d: Device): d is Device & { id: string } {
  return d.id !== null && !d.is_restricted;
}

/** The listed, controllable device matching the stored {name, type}. Prefers the active one. */
export function matchDevice(devices: Device[], pref: DevicePref | null): (Device & { id: string }) | undefined {
  if (!pref) return undefined;
  const matches = devices
    .filter(isUsable)
    .filter((d) => d.name === pref.name && d.type.toLowerCase() === pref.type.toLowerCase());
  return matches.find((d) => d.is_active) ?? matches[0];
}

/** First run (D13): preselect the desktop app when exactly one Computer is listed. */
export function firstRunDefault(devices: Device[]): (Device & { id: string }) | undefined {
  const computers = devices.filter(isUsable).filter((d) => d.type.toLowerCase() === 'computer');
  return computers.length === 1 ? computers[0] : undefined;
}

export interface DeviceSnapshot {
  devices: Device[];
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
}

export function createDeviceStore(fetchDevices: (signal?: AbortSignal) => Promise<Device[]>, now = Date.now) {
  let snap: DeviceSnapshot = { devices: [], fetchedAt: null, loading: false, error: null };
  let inflight: Promise<Device[]> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: Partial<DeviceSnapshot>) => {
    snap = { ...snap, ...next };
    listeners.forEach((fn) => fn());
  };

  function refresh(signal?: AbortSignal): Promise<Device[]> {
    if (!inflight) {
      set({ loading: true });
      inflight = fetchDevices(signal)
        .then((devices) => {
          set({ devices, fetchedAt: now(), loading: false, error: null });
          log('device', `devices: ${devices.map((d) => `${d.name} (${d.type}${d.is_active ? ', active' : ''})`).join('; ') || 'none'}`);
          return devices;
        })
        .catch((e: unknown) => {
          set({ loading: false, error: e instanceof Error ? e.message : String(e) });
          throw e;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  /** The cached list if it is fresh enough, otherwise a refetch. */
  async function get(maxAgeMs = DEVICE_CACHE_MS, signal?: AbortSignal): Promise<Device[]> {
    if (snap.fetchedAt !== null && now() - snap.fetchedAt <= maxAgeMs) return snap.devices;
    return refresh(signal);
  }

  return {
    get,
    refresh,
    getSnapshot: () => snap,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clear() {
      set({ devices: [], fetchedAt: null, loading: false, error: null });
    },
  };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;

export const deviceStore = createDeviceStore((signal) => getDevices({ signal }));

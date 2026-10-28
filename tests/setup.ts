import { afterEach, beforeEach, vi } from 'vitest';
import { resetAuthForTests } from '../src/auth/auth';
import { clearLogForTests } from '../src/diagnostics/log';

// A Map-backed localStorage, so tests don't depend on Node's Web Storage flags.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });

beforeEach(() => {
  localStorage.clear();
  resetAuthForTests();
  clearLogForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

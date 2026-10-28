// Namespaced localStorage. Logout clears `auth.*` only; `prefs.*` and `sets.*` survive.
export type StorageKey = `${'auth' | 'prefs' | 'sets'}.${string}`;

export function read<T>(key: StorageKey): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function write(key: StorageKey, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function remove(key: StorageKey): void {
  localStorage.removeItem(key);
}

export function clearNamespace(ns: 'auth' | 'prefs' | 'sets'): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${ns}.`)) doomed.push(key);
  }
  doomed.forEach((key) => localStorage.removeItem(key));
}

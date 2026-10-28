// Namespaced localStorage. Logout clears `auth.*` and `cache.*`; `prefs.*` and `sets.*` survive.
export type Namespace = 'auth' | 'cache' | 'prefs' | 'sets';
export type StorageKey = `${Namespace}.${string}`;

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

export function clearNamespace(ns: Namespace): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${ns}.`)) doomed.push(key);
  }
  doomed.forEach((key) => localStorage.removeItem(key));
}

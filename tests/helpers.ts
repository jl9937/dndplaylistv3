import { vi } from 'vitest';
import { write } from '../src/storage';

export function seedTokens(overrides: Partial<{ accessToken: string; refreshToken: string; expiresAt: number; loginAt: number }> = {}) {
  write('auth.tokens', {
    accessToken: 'A1',
    refreshToken: 'R1',
    expiresAt: Date.now() + 3_600_000,
    loginAt: Date.now(),
    ...overrides,
  });
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const empty = (status: number) => new Response(null, { status });

/** Stub fetch with a handler; returns the mock so tests can inspect calls. */
export function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const authHeader = (init: RequestInit) => (init.headers as Record<string, string>)?.Authorization;

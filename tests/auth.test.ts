import { describe, expect, it } from 'vitest';
import {
  daysUntilRelogin,
  getAccessToken,
  getAuthStatus,
  logout,
  readTokens,
  refreshAfter401,
  ReloginError,
} from '../src/auth/auth';
import { read, write } from '../src/storage';
import { json, seedTokens, stubFetch } from './helpers';

const isTokenCall = (url: string) => url === 'https://accounts.spotify.com/api/token';

describe('refresh', () => {
  it('concurrent 401s cause exactly one refresh', async () => {
    seedTokens();
    const fetch = stubFetch(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return json(200, { access_token: 'A2', expires_in: 3600 });
    });
    const results = await Promise.all([refreshAfter401('A1'), refreshAfter401('A1'), refreshAfter401('A1')]);
    expect(results).toEqual(['A2', 'A2', 'A2']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a late 401 carrying the old token reuses the already-refreshed token', async () => {
    seedTokens();
    const fetch = stubFetch(() => json(200, { access_token: 'A2', expires_in: 3600 }));
    await refreshAfter401('A1');
    expect(await refreshAfter401('A1')).toBe('A2');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stores a rotated refresh token at once and keeps loginAt', async () => {
    seedTokens({ loginAt: 123 });
    stubFetch(() => json(200, { access_token: 'A2', expires_in: 3600, refresh_token: 'R2' }));
    await refreshAfter401('A1');
    expect(readTokens()).toMatchObject({ accessToken: 'A2', refreshToken: 'R2', loginAt: 123 });
  });

  it('keeps the old refresh token when none is returned', async () => {
    seedTokens();
    stubFetch(() => json(200, { access_token: 'A2', expires_in: 3600 }));
    await refreshAfter401('A1');
    expect(readTokens()?.refreshToken).toBe('R1');
  });

  it('sends a refresh_token grant with the client id', async () => {
    seedTokens();
    const fetch = stubFetch(() => json(200, { access_token: 'A2', expires_in: 3600 }));
    await refreshAfter401('A1');
    const [url, init] = fetch.mock.calls[0];
    expect(isTokenCall(String(url))).toBe(true);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('R1');
    expect(body.has('client_secret')).toBe(false);
  });

  it('on invalid_grant clears auth only and asks for re-login', async () => {
    seedTokens();
    write('prefs.device', { name: 'Laptop', type: 'Computer' });
    stubFetch(() => json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }));
    await expect(refreshAfter401('A1')).rejects.toBeInstanceOf(ReloginError);
    expect(readTokens()).toBeNull();
    expect(read('prefs.device')).toEqual({ name: 'Laptop', type: 'Computer' });
    expect(getAuthStatus()).toBe('relogin-needed');
  });

  it('a network failure keeps the tokens', async () => {
    seedTokens();
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(refreshAfter401('A1')).rejects.toThrow('No connection');
    expect(readTokens()).not.toBeNull();
  });
});

describe('getAccessToken', () => {
  it('returns the stored token while valid', async () => {
    seedTokens();
    const fetch = stubFetch(() => json(500, {}));
    expect(await getAccessToken()).toBe('A1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes when expired', async () => {
    seedTokens({ expiresAt: 0 });
    stubFetch(() => json(200, { access_token: 'A2', expires_in: 3600 }));
    expect(await getAccessToken()).toBe('A2');
  });

  it('throws ReloginError when logged out', async () => {
    await expect(getAccessToken()).rejects.toBeInstanceOf(ReloginError);
  });
});

describe('logout and countdown', () => {
  it('logout clears auth.* but keeps prefs.*', () => {
    seedTokens();
    write('auth.pending', { verifier: 'v', state: 's' });
    write('prefs.device', { name: 'Laptop', type: 'Computer' });
    logout();
    expect(read('auth.tokens')).toBeNull();
    expect(read('auth.pending')).toBeNull();
    expect(read('prefs.device')).not.toBeNull();
    expect(getAuthStatus()).toBe('logged-out');
  });

  it('counts days until the 6-month refresh token expires', () => {
    const day = 86_400_000;
    const now = Date.now();
    seedTokens({ loginAt: now - 170 * day });
    expect(daysUntilRelogin(now)).toBe(12);
    seedTokens({ loginAt: now - 400 * day });
    expect(daysUntilRelogin(now)).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCallback, readTokens } from '../src/auth/auth';
import { read, write } from '../src/storage';
import { json, stubFetch } from './helpers';

const ORIGIN = 'http://127.0.0.1:5173';

beforeEach(() => {
  vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/` });
  vi.stubGlobal('history', { replaceState: vi.fn() });
});

const url = (q: string) => new URL(`${ORIGIN}/?${q}`);

describe('login callback (handled once, before React)', () => {
  it('does nothing without code or error', async () => {
    expect(await handleCallback(new URL(`${ORIGIN}/?debug`))).toEqual({ kind: 'none' });
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('exchanges the code once, stores tokens and scope, and cleans the URL (keeping ?debug)', async () => {
    write('auth.pending', { verifier: 'v', state: 's1' });
    const fetch = stubFetch(() => json(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'streaming' }));
    expect(await handleCallback(url('code=C&state=s1&debug&ubi=CAIQ3c'))).toEqual({ kind: 'ok' });
    expect(readTokens()).toMatchObject({ accessToken: 'A', refreshToken: 'R', scope: 'streaming' });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?debug'); // only ?debug survives, not Spotify's ubi
    const body = new URLSearchParams(String(fetch.mock.calls[0][1]?.body));
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/`);

    // A second call (StrictMode, double load) finds no pending login and doesn't exchange again.
    expect(await handleCallback(url('code=C&state=s1'))).toMatchObject({ kind: 'error' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a state mismatch without any token exchange', async () => {
    write('auth.pending', { verifier: 'v', state: 'expected' });
    const fetch = stubFetch(() => json(200, {}));
    expect(await handleCallback(url('code=C&state=forged'))).toEqual({ kind: 'error', message: 'Login could not be verified. Please try again.' });
    expect(fetch).not.toHaveBeenCalled();
    expect(read('auth.pending')).toBeNull();
  });

  it('turns a cancelled consent into a readable message', async () => {
    write('auth.pending', { verifier: 'v', state: 's' });
    expect(await handleCallback(url('error=access_denied&state=s'))).toEqual({ kind: 'error', message: 'Login was cancelled.' });
  });

  it('never shows the raw error text, and ignores ?error= when no login was started', async () => {
    expect(await handleCallback(url('error=Your+account+is+hacked'))).toEqual({ kind: 'none' });
    write('auth.pending', { verifier: 'v', state: 's' });
    expect(await handleCallback(url('error=Your+account+is+hacked&state=s'))).toEqual({
      kind: 'error',
      message: 'Spotify login failed. Please try again.',
    });
  });
});

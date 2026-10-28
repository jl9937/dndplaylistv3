import { describe, expect, it, vi } from 'vitest';
import { faults, formatLog, getLog, log } from '../src/diagnostics/log';
import { classify, request, SpotifyError } from '../src/spotify/client';
import { authHeader, empty, json, seedTokens, stubFetch } from './helpers';

describe('request', () => {
  it('accepts any 2xx and never parses an empty body', async () => {
    seedTokens();
    for (const status of [200, 202, 204]) {
      stubFetch(() => empty(status));
      expect(await request('PUT', '/me/player/play')).toEqual({ status, data: null });
    }
  });

  it('accepts a 2xx with a non-JSON text body, without logging the body', async () => {
    seedTokens();
    stubFetch(() => new Response('W9LvT-yLfB3xampleSnapshotId', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    expect(await request('PUT', '/me/player/play')).toEqual({ status: 200, data: null });
    expect(formatLog()).toContain('ignored non-JSON body');
    expect(formatLog()).not.toContain('W9LvT');
  });

  it('parses a JSON body', async () => {
    seedTokens();
    stubFetch(() => json(200, { id: 'me' }));
    expect((await request('GET', '/me')).data).toEqual({ id: 'me' });
  });

  it('on 401 refreshes once and retries with the new token', async () => {
    seedTokens();
    const fetch = stubFetch((url, init) => {
      if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'A2', expires_in: 3600 });
      return authHeader(init) === 'Bearer A2' ? json(200, { ok: true }) : json(401, { error: { status: 401 } });
    });
    expect((await request('GET', '/me')).data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('simulated 401 exercises a real refresh', async () => {
    seedTokens();
    faults.simulate401Next = true;
    const fetch = stubFetch((url, init) => {
      if (url.includes('accounts.spotify.com')) return json(200, { access_token: 'A2', expires_in: 3600 });
      return authHeader(init) === 'Bearer simulated-invalid-token' ? json(401, {}) : json(200, { ok: 1 });
    });
    await request('GET', '/me');
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://api.spotify.com/v1/me',
      'https://accounts.spotify.com/api/token',
      'https://api.spotify.com/v1/me',
    ]);
    expect(faults.simulate401Next).toBe(false);
  });

  it('waits for a short Retry-After, then retries', async () => {
    vi.useFakeTimers();
    seedTokens();
    let n = 0;
    stubFetch(() => (n++ === 0 ? json(429, {}, { 'Retry-After': '2' }) : json(200, { ok: 1 })));
    const p = request('GET', '/me');
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).data).toEqual({ ok: 1 });
  });

  it('does not sit through a Retry-After over 30 s', async () => {
    seedTokens();
    stubFetch(() => json(429, {}, { 'Retry-After': '300' }));
    const err = await request('GET', '/me').catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyError);
    expect(err.kind).toBe('rate-limited');
    expect(err.message).toContain('5 min');
  });

  it('reports QUOTA_EXCEEDED without waiting', async () => {
    seedTokens();
    stubFetch(() => json(429, { error: { status: 429, message: 'Quota', reason: 'QUOTA_EXCEEDED' } }, { 'Retry-After': '1' }));
    const err = await request('GET', '/me').catch((e) => e);
    expect(err.kind).toBe('quota');
  });

  it('retries a 5xx once by default', async () => {
    vi.useFakeTimers();
    seedTokens();
    let n = 0;
    stubFetch(() => (n++ === 0 ? empty(502) : json(200, { ok: 1 })));
    const p = request('GET', '/me');
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).data).toEqual({ ok: 1 });
  });

  it('does not retry a 5xx when retry5xx is false', async () => {
    seedTokens();
    const fetch = stubFetch(() => empty(503));
    const err = await request('PUT', '/me/player/play', { retry5xx: false }).catch((e) => e);
    expect(err.kind).toBe('server');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('turns fetch failures into a network error', async () => {
    seedTokens();
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect((await request('GET', '/me').catch((e) => e)).kind).toBe('network');
  });

  it('logs method, path and status, never query strings or tokens', async () => {
    seedTokens({ accessToken: 'SECRET_TOKEN' });
    stubFetch(() => empty(204));
    await request('PUT', '/me/player/play?device_id=abc');
    const text = formatLog();
    expect(text).toContain('PUT /me/player/play 204');
    expect(text).not.toContain('device_id');
    expect(text).not.toContain('SECRET_TOKEN');
  });
});

describe('classify', () => {
  it('403 Restriction violated', () => {
    expect(classify(403, { error: { status: 403, message: 'Player command failed: Restriction violated' } }).kind).toBe(
      'restriction',
    );
  });

  it('403 PREMIUM_REQUIRED', () => {
    const e = classify(403, { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } });
    expect(e.kind).toBe('premium');
    expect(e.message).toBe('Spotify Premium required.');
  });

  it('404 and 5xx', () => {
    expect(classify(404, null).kind).toBe('not-found');
    expect(classify(500, null).kind).toBe('server');
  });

  it('unknown errors show Spotify’s raw message', () => {
    expect(classify(400, { error: { status: 400, message: 'Invalid context uri' } }).message).toContain(
      'Invalid context uri',
    );
  });
});

describe('log hygiene', () => {
  it('scrubs secrets that slip into messages', () => {
    log('app', 'oops Bearer abc.def code=XYZ refresh_token=R1 /cb?code=1&state=2');
    const text = getLog().map((e) => e.msg).join('\n');
    expect(text).not.toMatch(/code=X|Bearer abc|refresh_token=R1|state=2/);
  });

  it('keeps only the last 200 events', () => {
    for (let i = 0; i < 250; i++) log('app', `e${i}`);
    expect(getLog()).toHaveLength(200);
    expect(getLog()[0].msg).toBe('e50');
  });
});

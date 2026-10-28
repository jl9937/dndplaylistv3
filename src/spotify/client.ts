// Fetch wrapper for api.spotify.com (spec §12.7): auth header, 401 → refresh → retry once,
// empty-body-safe 2xx, error classification, bounded 429 waits, one 5xx retry.

import { getAccessToken, refreshAfter401, ReloginError } from '../auth/auth';
import { API_BASE } from '../config';
import { faults, log, scrubUrl } from '../diagnostics/log';
import { sleep } from '../sleep';

export type ErrorKind =
  | 'relogin'
  | 'restriction'
  | 'premium'
  | 'not-found'
  | 'rate-limited'
  | 'quota'
  | 'server'
  | 'network'
  | 'unknown';

export class SpotifyError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status: number,
    /** User-facing message. */
    message: string,
    readonly spotifyMessage?: string,
    readonly reason?: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

interface ErrorBody {
  error?: { status?: number; message?: string; reason?: string } | string;
}

/** Longest 429 wait we sit through silently (spec §12.7). */
export const MAX_RATE_LIMIT_WAIT_SEC = 30;

export function classify(status: number, body: ErrorBody | null, retryAfterSec?: number): SpotifyError {
  const err = typeof body?.error === 'object' ? body.error : undefined;
  const msg = err?.message ?? (typeof body?.error === 'string' ? body.error : '');
  const reason = err?.reason;
  const raw = msg || `HTTP ${status}`;

  if (status === 401) return new SpotifyError('relogin', status, 'Log in again.', msg, reason);
  if (status === 403 && (reason === 'PREMIUM_REQUIRED' || /premium/i.test(msg))) {
    return new SpotifyError('premium', status, 'Spotify Premium required.', msg, reason);
  }
  if (status === 403 && /restriction violated/i.test(msg)) {
    return new SpotifyError('restriction', status, `Spotify refused: ${raw}`, msg, reason);
  }
  if (status === 404) {
    return new SpotifyError('not-found', status, `Spotify couldn't find that: ${raw}`, msg, reason);
  }
  if (status === 429) {
    const quota = reason === 'QUOTA_EXCEEDED' || /quota/i.test(msg);
    const wait = retryAfterSec ?? 0;
    const when = wait >= 120 ? `${Math.ceil(wait / 60)} min` : `${Math.max(1, wait)} s`;
    return quota
      ? new SpotifyError('quota', status, `Spotify quota hit, try again in ${when}.`, msg, reason, wait)
      : new SpotifyError('rate-limited', status, `Spotify is rate-limiting, try again in ${when}.`, msg, reason, wait);
  }
  if (status >= 500) {
    return new SpotifyError('server', status, 'Spotify is having problems. Try again shortly.', msg, reason);
  }
  return new SpotifyError('unknown', status, `Spotify error: ${raw}`, msg, reason);
}

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Retry a 5xx once after 500 ms. The play pipeline turns this off and does its own backoff. */
  retry5xx?: boolean;
}

export interface ApiResponse<T> {
  status: number;
  /** null for 204 and any other empty 2xx. */
  data: T | null;
}

export async function request<T>(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  pathOrUrl: string,
  opts: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : API_BASE + pathOrUrl;
  const label = `${method} ${scrubUrl(url).replace(API_BASE, '')}`;
  let token = await getAccessToken();
  let refreshed = false;
  let retried5xx = false;
  let waited429 = false;

  for (;;) {
    let sendToken = token;
    if (faults.simulate401Next) {
      faults.simulate401Next = false;
      sendToken = 'simulated-invalid-token'; // Spotify answers with a real 401
      log('api', `debug: simulating 401 on ${label}`);
    }

    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${sendToken}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      log('api', `${label} network error`);
      throw new SpotifyError('network', 0, 'No connection to Spotify. Check the internet connection.');
    }
    log('api', `${label} ${res.status} (${Math.round(performance.now() - started)} ms)`);

    if (res.ok) {
      // Any 2xx is success. Player commands may return a non-JSON text body
      // (seen 2026-10-28 on PUT /me/player/play), so never require JSON here.
      const text = await res.text();
      let data: T | null = null;
      if (text) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          log('api', `${label} ${res.status}: ignored non-JSON body (${text.length} bytes)`);
        }
      }
      return { status: res.status, data };
    }

    const body = await readErrorBody(res);

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      try {
        // Pass the real token (not a simulated bad one) so the refresh path is exercised.
        token = await refreshAfter401(token);
      } catch (e) {
        if (e instanceof ReloginError) throw classify(401, body);
        throw e;
      }
      continue;
    }

    if (res.status === 429 && !waited429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '') || 5;
      const err = classify(429, body, retryAfter);
      if (err.kind === 'quota' || retryAfter > MAX_RATE_LIMIT_WAIT_SEC) throw err;
      waited429 = true;
      log('api', `${label} rate limited; waiting ${retryAfter} s`);
      await sleep(retryAfter * 1000, opts.signal);
      continue;
    }

    if (res.status >= 500 && opts.retry5xx !== false && !retried5xx) {
      retried5xx = true;
      await sleep(500, opts.signal);
      continue;
    }

    throw classify(res.status, body);
  }
}

async function readErrorBody(res: Response): Promise<ErrorBody | null> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as ErrorBody) : null;
  } catch {
    return null;
  }
}

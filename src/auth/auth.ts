// Spotify Authorization Code + PKCE, entirely in the browser (spec §12.5, research §4).
// Tokens are always read from localStorage, never cached in memory, so a refresh
// done by another window is picked up immediately.

import {
  ACCOUNTS_BASE,
  CLIENT_ID,
  REFRESH_TOKEN_LIFETIME_DAYS,
  SCOPES,
  redirectUri,
} from '../config';
import { log } from '../diagnostics/log';
import { read, remove, write, clearNamespace } from '../storage';
import { challengeS256, generateState, generateVerifier } from './pkce';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Epoch ms of the original login. The refresh token dies ~6 months after this. */
  loginAt: number;
}

interface PendingLogin {
  verifier: string;
  state: string;
}

export type AuthStatus = 'logged-out' | 'logged-in' | 'relogin-needed';

export type CallbackResult =
  | { kind: 'none' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

/** Thrown when the refresh token is gone or rejected: the user must log in again. */
export class ReloginError extends Error {
  constructor(message = 'Log in again') {
    super(message);
    this.name = 'ReloginError';
  }
}

const TOKENS_KEY = 'auth.tokens';
const PENDING_KEY = 'auth.pending';
/** Token requests and the cross-window lock wait must never hang (a hung refresh blocks every request). */
const TOKEN_TIMEOUT_MS = 10_000;
const LOCK_WAIT_MS = 15_000;
/** Refresh this long before expiry, so a token never dies mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

// ---------- status store ----------

let reloginNeeded = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function getAuthStatus(): AuthStatus {
  if (reloginNeeded) return 'relogin-needed';
  return readTokens() ? 'logged-in' : 'logged-out';
}

export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  // Another window logged in, refreshed or logged out.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === TOKENS_KEY) notify();
  });
}

export function readTokens(): Tokens | null {
  return read<Tokens>(TOKENS_KEY);
}

function storeTokens(tokens: Tokens): void {
  write(TOKENS_KEY, tokens);
}

// ---------- login ----------

export async function startLogin(): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set. See README.');
  const verifier = generateVerifier();
  const state = generateState();
  write(PENDING_KEY, { verifier, state } satisfies PendingLogin);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeS256(verifier),
    state,
  });
  log('auth', 'redirecting to Spotify consent screen');
  location.assign(`${ACCOUNTS_BASE}/authorize?${params}`);
}

/**
 * Handle `?code=…&state=…` (or `?error=…`) exactly once, at module load before React
 * renders. The pending verifier is removed before the exchange, so a second call
 * (StrictMode, a double load) finds nothing to exchange.
 */
export async function handleCallback(url: URL = new URL(location.href)): Promise<CallbackResult> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return { kind: 'none' };

  // Clean the URL at once, keeping anything else (such as ?debug).
  for (const p of ['code', 'state', 'error']) url.searchParams.delete(p);
  history.replaceState(null, '', url.pathname + url.search + url.hash);

  const pending = read<PendingLogin>(PENDING_KEY);
  remove(PENDING_KEY);

  if (error) {
    log('auth', `login returned error: ${error}`);
    return {
      kind: 'error',
      message: error === 'access_denied' ? 'Login was cancelled.' : `Spotify login failed (${error}).`,
    };
  }
  if (!pending || pending.state !== state) {
    log('auth', 'login state mismatch; no token exchange');
    return { kind: 'error', message: 'Login could not be verified. Please try again.' };
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
      code_verifier: pending.verifier,
    });
    const json = await tokenRequest(body, 'code exchange');
    const now = Date.now();
    storeTokens({
      accessToken: json.access_token,
      refreshToken: json.refresh_token!,
      expiresAt: now + json.expires_in * 1000,
      loginAt: now,
    });
    reloginNeeded = false;
    notify();
    return { kind: 'ok' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Login failed.' };
  }
}

// ---------- tokens ----------

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(body: URLSearchParams, what: string): Promise<TokenResponse> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    log('auth', `${what}: ${timedOut ? 'timed out' : 'network error'}`);
    throw new Error(timedOut ? 'Spotify login service didn’t answer in time.' : 'No connection to Spotify.');
  }
  // Never log accounts.spotify.com bodies (spec §12.8): status and timing only.
  log('auth', `${what}: ${res.status} (${Math.round(performance.now() - started)} ms)`);
  if (res.ok) return (await res.json()) as TokenResponse;

  let errorCode = '';
  try {
    errorCode = ((await res.json()) as { error?: string }).error ?? '';
  } catch {
    /* non-JSON error body */
  }
  if ((res.status === 400 || res.status === 401) && errorCode === 'invalid_grant') {
    throw new ReloginError();
  }
  throw new Error(`Spotify login service error (${res.status}${errorCode ? `, ${errorCode}` : ''}).`);
}

let inflight: Promise<string> | null = null;

/** A valid access token, refreshing first if it is about to expire. */
export async function getAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new ReloginError('Not logged in');
  if (tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return tokens.accessToken;
  return refresh(tokens.accessToken);
}

/**
 * Called after a 401 that used `staleToken`. If someone already replaced that token,
 * use the new one; otherwise refresh. Concurrent callers share one refresh.
 */
export function refreshAfter401(staleToken: string): Promise<string> {
  return refresh(staleToken);
}

function refresh(staleToken: string): Promise<string> {
  if (!inflight) {
    inflight = withRefreshLock(() => doRefresh(staleToken)).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    try {
      return await navigator.locks.request('spotify-refresh', { signal: AbortSignal.timeout(LOCK_WAIT_MS) }, fn);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        log('auth', 'waited too long for the refresh lock held by another window');
        throw new Error('Login refresh is stuck in another app window. Close other windows, then try again.');
      }
      throw e;
    }
  }
  return fn();
}

async function doRefresh(staleToken: string): Promise<string> {
  // Inside the lock, re-read: another window may already have refreshed.
  const tokens = readTokens();
  if (!tokens) throw new ReloginError('Not logged in');
  if (tokens.accessToken !== staleToken && tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    log('auth', 'token already refreshed elsewhere; reusing it');
    return tokens.accessToken;
  }

  try {
    const json = await tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
      }),
      'token refresh',
    );
    const next: Tokens = {
      accessToken: json.access_token,
      // Spotify may rotate the refresh token. Store the new one at once.
      refreshToken: json.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
      loginAt: tokens.loginAt,
    };
    storeTokens(next);
    if (json.refresh_token && json.refresh_token !== tokens.refreshToken) {
      log('auth', 'refresh token rotated and stored');
    }
    notify();
    return next.accessToken;
  } catch (e) {
    if (e instanceof ReloginError) {
      clearNamespace('auth');
      reloginNeeded = true;
      notify();
    }
    throw e;
  }
}

// ---------- logout, countdown, debug ----------

export function logout(): void {
  clearNamespace('auth');
  reloginNeeded = false;
  log('auth', 'logged out');
  notify();
}

/** Whole days left before the refresh token expires, or null when logged out. */
export function daysUntilRelogin(now = Date.now()): number | null {
  const tokens = readTokens();
  if (!tokens) return null;
  const expires = tokens.loginAt + REFRESH_TOKEN_LIFETIME_DAYS * 86_400_000;
  return Math.max(0, Math.floor((expires - now) / 86_400_000));
}

/** Debug panel: make the next call refresh. */
export function expireAccessTokenNow(): void {
  const tokens = readTokens();
  if (!tokens) return;
  storeTokens({ ...tokens, expiresAt: 0 });
  log('auth', 'debug: access token marked expired');
}

export function resetAuthForTests(): void {
  inflight = null;
  reloginNeeded = false;
}

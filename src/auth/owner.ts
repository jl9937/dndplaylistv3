// The owner lock (D35): the app works for one Spotify account only, Jim's. Spotify's
// development mode already refuses accounts not added in the developer dashboard; this is a
// second wall in the app itself. Any other account is logged out at once.
//
// VITE_SPOTIFY_OWNER_ID is a build variable (a Spotify user ID, not a secret). Unset, the
// lock is off and the Log says so, so a missing variable can't lock the owner out.

import { log } from '../diagnostics/log';
import { SpotifyError } from '../spotify/client';
import type { CallbackResult } from './auth';

export const OWNER_ID: string = import.meta.env.VITE_SPOTIFY_OWNER_ID ?? '';

export const isOwner = (userId: string | null | undefined, owner = OWNER_ID) => !owner || userId === owner;

export const lockedOutMessage = (userId?: string) =>
  `This app is private. ${userId ? `The Spotify account “${userId}” isn’t allowed` : 'Spotify refused this account'}, so you’ve been logged out.`;

let lockout: string | null = null;
/** Why the last session was ended by the lock, for the login screen. */
export const getLockout = () => lockout;

interface Deps {
  getMe: () => Promise<{ id: string }>;
  logout: () => void;
  owner?: string;
}

/** Straight after a login: is this the owner? If not, end the session before the app starts. */
export async function verifyOwner(deps: Deps): Promise<CallbackResult> {
  const owner = deps.owner ?? OWNER_ID;
  if (!owner) {
    log('auth', 'owner lock is off: VITE_SPOTIFY_OWNER_ID is not set');
    return { kind: 'ok' };
  }
  try {
    const me = await deps.getMe();
    if (isOwner(me.id, owner)) return { kind: 'ok' };
    return lockOut(deps.logout, me.id);
  } catch (e) {
    log('auth', `owner check failed: ${e instanceof Error ? e.message : String(e)}`);
    // Fail closed either way. A network or Spotify fault isn't a refusal, so say so.
    if (e instanceof SpotifyError && ['network', 'server', 'rate-limited', 'quota'].includes(e.kind)) {
      deps.logout();
      return { kind: 'error', message: 'Couldn’t confirm which Spotify account this is, so you’ve been logged out. Please log in again.' };
    }
    // Spotify answers 403 for accounts not registered in the developer dashboard.
    return lockOut(deps.logout);
  }
}

/** End a session that isn't the owner's: tokens and caches are cleared. */
export function lockOut(logout: () => void, userId?: string): CallbackResult {
  log('auth', 'owner lock: not the owner; logged out');
  lockout = lockedOutMessage(userId);
  logout();
  return { kind: 'error', message: lockout };
}

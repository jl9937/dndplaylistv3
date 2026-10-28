export const CLIENT_ID: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';

export const BUILD_ID: string = typeof __BUILD_ID__ === 'undefined' ? 'test' : __BUILD_ID__;

export const API_BASE = 'https://api.spotify.com/v1';
export const ACCOUNTS_BASE = 'https://accounts.spotify.com';

/** Milestone 1 scopes only (spec §9). 1b adds streaming, user-read-email, user-read-private. */
export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
];

/** The app root is the redirect URI: http://127.0.0.1:5173/ in dev, the workers.dev URL in production. */
export function redirectUri(): string {
  return location.origin + import.meta.env.BASE_URL;
}

/** Refresh tokens last about 6 months from login; refreshing does not extend them. */
export const REFRESH_TOKEN_LIFETIME_DAYS = 182;
export const RELOGIN_WARN_DAYS = 14;

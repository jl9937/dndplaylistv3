import { useState } from 'react';
import { startLogin } from '../auth/auth';
import { CLIENT_ID } from '../config';

export function LoginScreen({ message, relogin }: { message?: string; relogin?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const login = () => startLogin().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

  return (
    <main className="login">
      <h1>D&amp;D Playlist Manager</h1>
      {relogin && <p className="notice">Your Spotify login has expired. Your settings are kept.</p>}
      {message && <p className="notice error">{message}</p>}
      {error && <p className="notice error">{error}</p>}
      {!CLIENT_ID ? (
        <p className="notice error">
          Setup needed: <code>VITE_SPOTIFY_CLIENT_ID</code> is not set. See the README.
        </p>
      ) : (
        <button className="primary big" onClick={login}>
          {relogin ? 'Log in again' : 'Log in with Spotify'}
        </button>
      )}
    </main>
  );
}

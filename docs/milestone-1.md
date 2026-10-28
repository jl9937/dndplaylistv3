# Milestone 1: Log in, list, play (remote control)

Status: built 2026-10-28, awaiting real-Spotify testing and the soak test · Revised after review and grilling, 2026-10-28 · Parent: [spec.md](spec.md) · Next: [milestone-1b.md](milestone-1b.md)

## Goal

A web app I run myself, where I can log in to Spotify, see all my playlists, click one, and hear it start playing in the **Spotify desktop app** on my laptop (D13). It never fails silently.

This milestone proves the main path first: PKCE under the 2025 redirect rules, Spotify Connect device targeting, and **reliable confirmed playback**. The in-browser player (Web Playback SDK) is deliberately left out. It arrives as the automatic fallback in [Milestone 1b](milestone-1b.md) (decision D16).

## Scope

**In:**
- login/logout
- playlist list with filter
- device selection (the desktop app by default, a phone or any other listed device)
- click-to-play through the play pipeline, with confirmation, a random start, shuffle and repeat
- Pause/Resume
- Ready check
- debug panel
- installable app window
- local dev and production deploy

**Out:**
- moved to 1b: the in-browser player and everything that exists only for it (SDK lifecycle, recovery ladder, wake detection, `autoplay_failed`, single-instance guard, the `streaming` scope)
- later milestones: session sets, Board, compact strip, keyboard shortcuts, now-playing details, user-facing shuffle/repeat settings, tags, playlist descriptions

## Prerequisites (one-time, manual, done by Jim)

1. Create a free Cloudflare account and a Worker connected to the GitHub repo (see Deploy below). Done: `https://dndplaylistv3.jim-lumsden.workers.dev/`.
2. In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), create an app.
   - APIs: **Web API**. Add **Web Playback SDK** now too, ready for 1b.
   - Redirect URIs:
     - `http://127.0.0.1:5173/` (local dev). Check that it saved as `127.0.0.1`, not `localhost`.
     - The production URL (D7), `https://dndplaylistv3.jim-lumsden.workers.dev/`. It must match exactly, including the trailing slash.
3. Under **User Management**, add the email of the Spotify account you will log in with.
4. Copy the **Client ID**. It is public. It goes in `.env` as `VITE_SPOTIFY_CLIENT_ID` locally, and in the Cloudflare build environment for deploys. There is no client secret; do not create or use one.
5. Make sure the developer account and the listening account have full Spotify Premium.
6. In the **Spotify desktop app**, turn **Autoplay** off (Settings → Autoplay), so that Spotify never adds its own tracks (D15).
7. In Chrome or Edge, add the production URL to **Settings → Performance → "Always keep these sites active"**, so Memory Saver never discards the app window.

## User stories and acceptance criteria

### US-1: Log in
As the DM, I want to log in with my Spotify account so the app can see my playlists.
- [ ] Logged out, the page shows the app name and a **Log in with Spotify** button, and nothing else.
- [ ] Clicking it goes to Spotify's consent screen. The screen lists **only the Milestone 1 scopes** in [spec §9](spec.md#9-spotify-scopes).
- [ ] After I approve, I return to the app, logged in. The URL no longer contains `code` or `state`.
- [ ] The `?code` callback is handled once, at module load before React renders. In dev mode (StrictMode) there is still exactly one token exchange (check the debug log).
- [ ] If `state` does not match, or Spotify returns `error`, the app shows a readable message and the login button again. No token exchange happens.
- [ ] When I reload the page, I am still logged in and do not see the consent screen.
- [ ] Using **Expire access token now** in the debug panel, the next action refreshes silently and succeeds.
- [ ] Using **Simulate 401 on next request**, the request refreshes once, retries, and succeeds. Several concurrent 401s cause exactly **one** refresh. That includes two app windows open at once (Web Locks).
- [ ] A rotated refresh token returned by Spotify is stored at once.
- [ ] The app shows "Re-login needed in N days" when 14 or fewer days remain of the 6-month refresh-token lifetime.
- [ ] On `invalid_grant` during refresh, the app shows **Log in again** (one click). Preferences are kept.

### US-2: Log out
- [ ] **Log out** clears the `auth.*` storage keys and in-memory caches, and returns to the logged-out view. `prefs.*` (for example the device choice) is kept.

### US-3: See my playlists
- [ ] Once logged in, the app calls `GET /me` (for `id` only) and then shows **all** my playlists, following `next` links on `GET /me/playlists?limit=50` until done.
- [ ] Each row shows cover image (or placeholder), name, and owner name if the owner's ID is not mine.
- [ ] A filter box narrows the list by name, case-insensitive, as I type.
- [ ] The app shows a loading state while fetching and an error state with **Retry** if fetching fails.
- [ ] Playlist names render as text. Descriptions are not shown.

### US-4: Choose where it plays
- [ ] A device picker lists the devices from `GET /me/player/devices`, with a refresh button.
- [ ] **The default device is the Spotify desktop app on this laptop (D13).** On first run, if exactly one `Computer` device is listed, it is preselected and I confirm it. If there are several, I pick one.
- [ ] The device choice is stored as `{name, type}` (never by ID), and restored on load when a matching device is listed.
- [ ] If the chosen device isn't listed when I press a playlist (after one device-list refresh), the row shows **Failed: "Spotify isn't open on <name>. Open it, then press again."** with **Try again**. The app never switches device by itself (automatic fallback arrives in 1b).
- [ ] Quitting and reopening the Spotify desktop app mid-session: the next press finds it again by name and type, and plays there.
- [ ] If my phone is listed, choosing it and pressing a playlist plays on the phone. If it is not listed, the picker says "Open Spotify on your phone, then refresh."

### US-5: Click to play, reliably
This is the core of the milestone (D3). The design is in [spec §12.3–12.4](spec.md#123-confirmation). The SDK-only steps are skipped until 1b.
- [ ] Clicking a playlist runs the play pipeline with an overall 12 s deadline. The row shows the current step ("Starting…", "Retrying…").
- [ ] Every play, pause, shuffle and repeat command sends an explicit `device_id`. Any 2xx counts as "accepted", **not** as "playing".
- [ ] **Playing** is shown only when observed state (`GET /me/player`) matches: the right device, the right playlist ID, not paused, and position advancing.
- [ ] A 404, 502 or 503 on the command is retried with backoff (250 ms, then 750 ms) once.
- [ ] If the command is accepted but `GET /me/player` shows nothing active, another device or another playlist, the app wakes the device (transfer with `play: false`), then re-sends once (spec §12.4 step 6). If it shows our playlist on our device, the app waits and doesn't re-send.
- [ ] If confirmation fails, the row shows **Failed** with a reason, plus **Try again** and **Choose another device**. If confirmation arrives within about 10 s afterwards, the row switches to **Playing**.
- [ ] Pressing another playlist while one is starting supersedes it. Only the latest press can reach **Playing**.
- [ ] Each press starts at a **random track** (D14), then plays shuffled. Pressing the same owned playlist several times starts at different tracks.
- [ ] After each confirmed press, shuffle is **on** and repeat is **context** on the target device, even if I changed them in the Spotify app beforehand (D14, D15).
- [ ] A short test playlist (2–3 tracks) loops back to its start instead of stopping.
- [ ] **Pause/Resume** works on the selected device. Pausing when already paused (403 "Restriction violated") is handled quietly.

### US-6: Errors and diagnostics
- [ ] Errors are classified as in [spec §12.7](spec.md#127-error-classification). Unknown errors show Spotify's raw message.
- [ ] The debug panel (opened with `?debug` or a "Log" link) shows the last 200 events, with **Copy log**, **Expire access token now** and **Simulate 401 on next request**.
- [ ] The log never contains tokens, `Authorization` headers, query strings, or `accounts.spotify.com` request or response bodies. Check by searching a copied log for `code=`, `Bearer` and `refresh_token`.

### US-7: Ready check
- [ ] A **Ready check** button runs [spec §12.6](spec.md#126-ready-check-pre-session) and shows each step green or red:
  - token valid, and days until re-login;
  - the chosen device is listed;
  - a test play is confirmed, then paused;
  - shuffle is on and repeat is set to the playlist;
  - an "Autoplay is off in Spotify" tick-box.
- [ ] The test playlist is picked from a dropdown in the Ready check, remembered (`prefs.readyCheckPlaylist`), and defaults to the last playlist pressed.

## Technical design

### Stack
Vite + React + TypeScript, plain CSS, Vitest. No router, no state library, no Spotify wrapper package. Reasons are in [research.md §5](research.md#5-q3-which-framework).

### Proposed layout
```
index.html
public/
  manifest.webmanifest     name, icons, display: standalone, theme colours (D11)
  icons/                   app icons
  _headers                 CSP and security headers (Cloudflare static assets)
vite.config.ts             127.0.0.1:5173, strictPort
src/
  main.tsx                 handles the ?code callback BEFORE rendering React
  App.tsx                  logged-out vs logged-in shell
  config.ts                client id, redirect uri (derived from location), M1 scopes
  storage.ts               namespaced localStorage helpers (auth.*, prefs.*)
  auth/
    pkce.ts                verifier, challenge, state generation
    auth.ts                login redirect, callback, single-flight + Web Locks refresh,
                           logout, getAccessToken(), re-login countdown
  spotify/
    client.ts              fetch wrapper: auth header, 401→refresh→retry once,
                           empty-body-safe 2xx, error classification, 429/5xx handling
    api.ts                 getMe(), getMyPlaylists(), getDevices(), getPlaybackState(),
                           play(), pause(), resume(), setShuffle(), setRepeat()
    types.ts               Playlist (items optional), Device, PlaybackState, Paging<T>
    uri.ts                 playlist ID parsing (both URI forms)
  playback/
    devices.ts             device list cache (≤30 s), match stored {name, type}
    pipeline.ts            sequence numbers, deadline, random offset, command/retry,
                           confirm, late confirm, shuffle/repeat enforcement
    readyCheck.ts
  diagnostics/
    log.ts                 ring buffer (200), scrubbing, dev fault-injection flags
  ui/
    LoginScreen.tsx  PlaylistList.tsx  DevicePicker.tsx  PlayerBar.tsx
    ReadyCheck.tsx   DebugPanel.tsx
  styles.css
tests/
  pkce.test.ts             verifier length/charset, S256 challenge vector
  auth.test.ts             concurrent 401s → one refresh; rotated token stored; invalid_grant
  client.test.ts           empty 2xx, 429 Retry-After cap, 5xx retry, 403 classification
  uri.test.ts              both playlist URI forms
  devices.test.ts          {name, type} matching; first-run Computer preselect
  pipeline.test.ts         confirm, late confirm, supersede, 404 retry, deadline,
                           random offset bounds, shuffle/repeat enforcement (fake timers)
.github/workflows/ci.yml   type-check + tests (no deploy)
.env.example               VITE_SPOTIFY_CLIENT_ID=
```
The pipeline takes the device as an interface (`play`, `confirm`), so 1b can add the SDK device without restructuring it.

### Redirect URI and dev server
- Compute the redirect URI at runtime as `location.origin + import.meta.env.BASE_URL`. `base` is `/`.
- `vite.config.ts`: `server: { host: '127.0.0.1', port: 5173, strictPort: true }`. If the port is busy, fail rather than silently moving to 5174, which would break login.
- `vite preview` (port 4173) is not a registered redirect URI. Use `npm run dev` for login testing, or also register `http://127.0.0.1:4173/` if needed.

### Content Security Policy
Delivered as real HTTP headers through `public/_headers`, which Cloudflare applies **only in production** (Workers static assets read `dist/_headers`). The dev server runs without CSP: it needs inline scripts and styles and a websocket.
```
default-src 'self';
script-src 'self';
connect-src 'self' https://api.spotify.com https://accounts.spotify.com;
img-src 'self' https://*.scdn.co https://*.spotifycdn.com data:;
style-src 'self';
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```
Plus the headers `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Milestone 1b adds `https://sdk.scdn.co` to `script-src` and `frame-src`.

### Deploy (D9)
- **Cloudflare Workers Builds (Git integration):** connect the GitHub repo once in the Cloudflare dashboard. Every push to `main` deploys to production. Other branches and pull requests get preview URLs.
  - Build command: `npm ci && npm test && npm run build`, so failing tests stop the deploy.
  - Deploy command: `npx wrangler deploy`. It reads `wrangler.jsonc`, which serves `dist/` as static assets with single-page-app fallback. `wrangler` is pinned in `package.json`.
  - Build variable: `VITE_SPOTIFY_CLIENT_ID` (public). It must be a **build** variable, because Vite bakes it in at build time.
- **Install scripts:** `package.json` denies the install scripts of `esbuild`, `fsevents` and `workerd` (`allowScripts`). Static-asset deploys don't need them.
- **Cloudflare Access stays off** on the `workers.dev` URL (D9).
- **No deploy credentials exist anywhere:** no Cloudflare token is stored in GitHub.
- **Preview URLs can't log in:** they aren't registered redirect URIs, which is intentional. Test login locally or in production.
- **GitHub Actions** runs type-check and tests on every push and pull request. It has `permissions: contents: read` only, and actions are pinned to commit SHAs.
- `package-lock.json` is committed, and `npm ci` is used. Dependabot is enabled for npm and actions.

### Endpoints used
| Call | Purpose |
|---|---|
| `GET https://accounts.spotify.com/authorize` | Start login |
| `POST https://accounts.spotify.com/api/token` | Exchange code; refresh |
| `GET /v1/me` | My user `id` (for the owner label) |
| `GET /v1/me/playlists?limit=50` (+ `next`) | Library, including `items.total` for the random offset |
| `GET /v1/me/player/devices` | Device picker; device present check |
| `GET /v1/me/player` | Confirm playback (204 = nothing active) |
| `PUT /v1/me/player` | Wake the device by transfer (`play: false`), fallback only |
| `PUT /v1/me/player/play?device_id=…` | Start playlist (with random `offset`) / resume |
| `PUT /v1/me/player/pause?device_id=…` | Pause |
| `PUT /v1/me/player/shuffle?state=true&device_id=…` | Shuffle on (after confirmation; D14) |
| `PUT /v1/me/player/repeat?state=context&device_id=…` | Repeat playlist (after confirmation; D15) |

## Definition of done
- [ ] All acceptance criteria above pass, tested by hand on desktop Chrome or Edge (D8).
- [ ] Unit tests pass (see the layout above).
- [ ] **Reliability soak test** on the Spotify desktop app. For every press, record: heard (Y/N), UI result, and seconds to confirm.
  - (a) **Rapid:** 30 presses across at least 5 playlists.
  - (b) **Session simulation:** 2–3 hours, one press every 10–20 minutes, with this app's window in the background between presses.
    - The music is paused for at least 2 of the gaps.
    - The laptop lid is closed at least once.
    - Spotify itself is used at least once (play or skip inside the desktop app).
    - The Spotify app is quit and reopened at least once.
    - At least one gap of **30+ minutes with the Spotify desktop app minimised and paused**. This is the condition most likely behind the earlier builds' silent failures (D3).
  - (c) **Phone:** 10 presses, each after the phone's Spotify app has been in the background for 5+ minutes.
  - **Pass:** 0 silent failures; 2 or fewer false Failed (Failed shown while music plays) in total; 95% of presses in (a) confirmed within 3 s.
- [ ] Deployed to Cloudflare (D7) and working end-to-end there, with no CSP violations in the console.
- [ ] Chrome or Edge offers **Install as app**. The installed app opens in its own window and logs in fine there.
- [ ] `README.md` explains setup: Cloudflare and Spotify dashboard steps, `.env`, `npm run dev`, deploy, Autoplay off, and the Memory Saver exclusion.
- [ ] No client secret, token or personal data committed.
- [ ] Soak-test results and spike notes added to [research.md §6](research.md#6-open-risks-to-check-in-a-spike).

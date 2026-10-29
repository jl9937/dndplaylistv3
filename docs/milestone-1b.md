# Milestone 1b: In-browser player as automatic fallback

Status: shipped in **v1.0** (2026-10-29). Built against a fake SDK and the real SDK script; real playback through "This browser" is lightly tested · Parent: [spec.md](spec.md) · Builds on: [milestone-1.md](milestone-1.md)

## Goal

If the Spotify desktop app isn't running when I press a playlist, the music plays in this app's own window instead (the Web Playback SDK), with a visible notice. It never fails silently, and it never switches to my phone by itself.

## Scope

**In:**
- the SDK player as a device ("This browser")
- its full lifecycle and recovery (spec [§12.2](spec.md#122-sdk-device-lifecycle))
- automatic fallback from the desktop app
- autoplay handling
- the single-instance guard
- SDK debug actions
- the added scopes and CSP

## Changes from Milestone 1
- **Scopes:** add `streaming`, `user-read-email` and `user-read-private` (needed by the SDK). Existing users get the consent screen again once.
- **CSP:** add `https://sdk.scdn.co` to `script-src` and `frame-src`.
- **Layout:**
  - `src/player/webPlayback.ts`: the SDK singleton (loader, lifecycle state machine, registration polling, recovery ladder, wake detection, `getOAuthToken` → `getAccessToken()`).
  - `src/player/sdkDevice.ts`: "This browser" as a pipeline device.
  - `src/playback/fallback.ts`: the per-press automatic fallback.
  - `src/player/instance.ts`: the single-instance guard. It uses **Web Locks** rather than a BroadcastChannel: the lock dies with the tab, and "Use this tab instead" steals it.
- **Existing logins:** tokens record their granted scopes now. A login from before 1b lacks `streaming`, so "This browser" shows **needs a one-time re-login**, with a button. Remote control keeps working meanwhile.
- **CSP findings:** with the real SDK script loaded, the page itself contacted only `sdk.scdn.co`. Streaming happens inside the SDK's own iframe.

## User stories and acceptance criteria

### US-1b-1: "This browser" as a device
- [ ] On load, the app creates one Web Playback SDK player (a module-level singleton, safe under StrictMode) named **"D&D Playlist Manager"**.
- [ ] "This browser" appears in the device picker with its live lifecycle state: loading / connecting / waiting for Spotify / ready / recovering / failed (with the reason and next step). It shows **ready** only once the device appears in `GET /me/player/devices`.
- [ ] If the SDK script is blocked (an ad blocker, or no network), "This browser" shows "Spotify player blocked. Allow sdk.scdn.co", and the other devices still work.
- [ ] SDK error events map to the named states in spec §12.2.

### US-1b-2: Automatic fallback
- [ ] If the stored desktop app isn't listed when I press a playlist (after one device-list refresh), the app plays in "This browser". It shows the notice "Spotify app not found, playing in this window", which I can dismiss.
- [ ] The fallback only ever goes to "This browser", never to a phone or any other device.
- [ ] Once the desktop app is listed again, the next press goes back to it.

### US-1b-3: Recovery
- [ ] **Kill SDK player** in the debug panel, then press a playlist: the app recovers and plays within the 12 s deadline, or shows **Reload page**.
- [ ] After the laptop wakes from sleep, recovery starts without a press (visible in the status and the log).
- [ ] A 404 or 5xx on the SDK device triggers re-registration and one more command (spec §12.4 steps 4 and 6).

### US-1b-4: Audio activation
- [ ] For "This browser", `activateElement()` is called synchronously in the click handler, before any `await`.
- [ ] If the SDK fires `autoplay_failed`, a large **Click to enable audio** button appears. Clicking it starts the audio.

### US-1b-5: Single instance
- [ ] Opening a second app window or tab shows "The app is open in another tab. [Use this tab instead]". The second one doesn't create a second SDK player.

## Definition of done
- [ ] All acceptance criteria pass on Chrome or Edge.
- [ ] Unit tests: SDK lifecycle state machine and fallback selection (with a mocked SDK).
- [ ] **Soak test, fallback path:** with the desktop app quit, 15 rapid presses, then a 1-hour simulation (a press every 10–15 minutes, window in the background, one lid close). Pass: 0 silent failures.
- [ ] No CSP violations in the console in production.

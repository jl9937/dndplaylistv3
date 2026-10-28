# Product specification: D&D Playlist Manager

Status: draft v3 (independent review applied) · Owner: Jim · Last updated: 2026-10-28

## 1. Problem

As a dungeon master, I curate dozens of Spotify playlists for background music: tavern, travel, combat, boss fight, dungeon, mystery, and so on. During a session I need to switch between them quickly as the scene changes. Spotify's UI makes this slow: playlists sit inside nested folders, the search and library views are built for listening rather than live switching, and every switch takes several clicks while players wait.

## 2. Solution in one sentence

A small web app that sits on top of Spotify. **Before** the session, I pick a handful of playlists. **During** the session, those playlists are big one-click buttons that start playback on my chosen Spotify device.

## 3. Users

- **Primary:** me (the DM), running the app on a laptop at the table. Audio usually plays from that laptop and occasionally from a separate phone (see [§11](#11-decisions-2026-10-28)).
- **Secondary (maybe later):** up to four other DMs I share it with. Spotify Development Mode caps the app at 5 users. See [research.md](research.md#1-spotify-platform-constraints-read-this-first).
- **Not a goal:** public use. Spotify will not grant extended quota to a hobby app.

## 4. Principles

1. **Spotify plays the music; we control it.** The app never handles Spotify audio itself. It tells a Spotify Connect device what to play. Ambience (Milestone 4) is a separate audio layer that the app plays itself, from non-Spotify sources.
2. **One click mid-session.** Any in-session action must be one tap/click or one key press.
3. **Never fail silently.** Every press ends either in confirmed playback or in a visible failure message with a next step. This was the biggest problem in earlier builds. See [§12](#12-playback-reliability).
4. **No backend.** Static site, browser-only PKCE auth. See [research.md §4](research.md#4-q2-how-do-we-handle-authentication-securely).
5. **Minimum scopes, minimum dependencies.**
6. **Our grouping replaces Spotify folders.** The Spotify API does not expose folders, so we do not try to copy them.

## 5. Concepts

| Term | Meaning |
|---|---|
| **Library** | All playlists returned by `GET /me/playlists` (owned and followed). Flat list. |
| **Session set** | A named, ordered selection of playlists for one game session, for example "Session 14: Sunless Citadel". |
| **Board** | The in-session view: the current session set shown as large buttons. |
| **Device** | A Spotify Connect target: "This browser" (Web Playback SDK) or any other active Spotify client. |
| **Tag** | The type marker already in a playlist's name (for example town, mood, scenario), parsed by the app. Replaces folders for browsing and grouping. The **short name** is the name with the tag removed. |
| **Scene** | One item in a session set: a playlist, plus an optional label and (from Milestone 4) an ambience preset. |
| **Ambience layer** | One looping, non-Spotify background sound with its own volume (Milestone 4). |
| **Studio** | The playlist design and analysis page (Milestone 5). |

## 6. Architecture

```
┌────────────────────── Browser (static SPA, Vite + React + TS) ───────────────────────┐
│                                                                                        │
│  auth/        PKCE login, token refresh, logout                                        │
│  spotify/     thin typed fetch client: me, playlists, devices, play, pause, shuffle    │
│  player/      Web Playback SDK wrapper → registers "This browser" as a Connect device  │
│  ui/          Library view, Board view, device picker, now playing                     │
│  storage/     localStorage: refresh token, session sets, settings                     │
│                                                                                        │
│  later:                                                                                │
│  ambience/    Web Audio engine: looping layers, per-layer gain (M4)                    │
│  studio/      track table, features, charts, clustering, move tracks (M5)              │
│               IndexedDB: cached audio features, imported sound files                   │
│                                                                                        │
└──────────────┬───────────────────────────────────────────────┬────────────────────────┘
               │ HTTPS                                          │ HTTPS
     accounts.spotify.com                                 api.spotify.com
     (authorize, token)                                   (Web API, player)
                                                               │
                                               Spotify Connect device plays music
                                    (this browser via SDK, desktop app, phone, speaker)

     Ambience audio (M4): plays from this browser through Web Audio, independent of Spotify.
     Audio features (M5): third-party API, e.g. ReccoBeats (to be validated).
```

The music and ambience audio paths are deliberately independent. If music plays on the phone, ambience still plays from the laptop.

- **Hosting:** Cloudflare Workers static assets, at `https://dndplaylistv3.jim-lumsden.workers.dev/` (D7). Local dev on `http://127.0.0.1:5173/`.
- **Redirect URI:** the app root (no `/callback` route), so no SPA fallback is needed for the login callback.
- **Persistence:** `localStorage` only, with namespaced keys (`auth.*`, `prefs.*`, `sets.*`). No server, no database. Session sets can be exported and imported as JSON (Milestone 2).
- **Origin:** browser storage is shared by every page on the same origin. See D7.

## 7. Functional requirements by milestone

### Milestone 1: Log in, list, play (spike and foundation)
Detailed in [milestone-1.md](milestone-1.md).
- Log in with Spotify (PKCE). Log out.
- List all my playlists (all pages), with cover art and name, plus a text filter.
- Pick a device: the Spotify desktop app (the default, D13), or another listed Spotify device such as a phone.
- Click a playlist to start it playing on the selected device, through the [play pipeline](#124-the-play-pipeline) with confirmation, a random start, shuffle and repeat (D14, D15).
- Installable as an app window (web app manifest and icons; D11).
- Debug panel with the event log and test actions.
- Ready check before a session.

### Milestone 1b: In-browser player as automatic fallback
Detailed in [milestone-1b.md](milestone-1b.md). Split out of Milestone 1 (D16).
- "This browser" (Web Playback SDK) as a device, with the full lifecycle and recovery in [§12.2](#122-sdk-device-lifecycle).
- Automatic fallback to it when the desktop app isn't listed, with a visible notice.
- Autoplay handling and the single-instance guard.

### Milestone 2: Board, session sets, tags from names
Split into 2a and 2b (D18). 2a is detailed in [milestone-2a.md](milestone-2a.md).
- **Tags from playlist names:** parse the tag already in each playlist name (for example a town, mood or scenario prefix) with a configurable rule. Show the **short name** with the tag removed, and **group the Library by tag**. Display only: Spotify names are not changed. See [§13.1](#131-tags-from-playlist-names).
- Mark playlists as part of a session set from the Library view (star/checkbox).
- Board view: the set's playlists as large tiles in my chosen order (drag to reorder).
- **Quick switch to any playlist:** from the Board, one key (`/` or `Ctrl/Cmd+K`) opens a search palette over the *whole* library, grouped by tag. `Enter` plays the result through the same play pipeline. An option adds it to the current set. See [§13.2](#132-reaching-non-selected-playlists-mid-session).
- Keyboard shortcuts: `1`–`9` start the matching tile. (`Space` dropped, D23.)
- Now-playing strip: current playlist, track, play/pause, next, volume.
- Shuffle on by default when starting a playlist (setting). Repeat context on, so the music does not stop.
- ~~Several saved session sets. Switch between them.~~ Dropped: one Board (D23).
- ~~Export and import session sets as JSON.~~ Dropped (D23). Call `navigator.storage.persist()` on first save.
- Session set items are stored as **scene** objects, not bare playlist IDs, so that ambience layers can be attached later without migrating data (see [§5](#5-concepts)).
- **Compact mode** (D12): (A) docked strip, then (B) always-on-top floating strip after a spike. See [§13.5](#135-compact-mode).
- Hash-based page routing (`#/board`, `#/library`, later `#/ambience`, `#/studio`). It needs no server-side SPA fallback.

### Milestone 3: Quality of life
- Manual tag overrides for playlists whose names don't follow the convention.
- Include tag overrides in the JSON export.
- Resume position: return to a playlist where it left off rather than restarting. Needs research: the API has no per-context resume, so we would store the last track URI and position per playlist and pass `offset` and `position_ms`.
- Soft transitions: fade down, switch, fade up. On "This browser" use the SDK's `player.setVolume()` (local, instant). On remote devices use a few coarse `PUT /me/player/volume` steps, or none: that endpoint is rate-limited and its commands don't run in a guaranteed order.
- Offline shell (a service worker) so the app window opens instantly. Service-worker scope needs a unique origin (D7).

### Milestone 4: Ambience mixer (starts with a research spike)
- Play **looping background sounds** (water, crowd, wind, fire, rain…) layered *on top of* the Spotify music.
- Each layer has its own **volume slider** and on/off toggle. There is a master ambience volume.
- Several layers play at once with **gapless looping**.
- Ambience presets can be attached to scenes, so pressing a scene tile starts the playlist *and* its ambience layers.
- Sounds do **not** come from Spotify or YouTube. See [§13.3](#133-ambience-mixer) for the engine and [research.md §7](research.md#7-later-milestones-research) for sources.

### Milestone 5: Playlist Studio (starts with a research spike)
- A separate page for *designing* playlists, not playing them.
- A table of tracks in a playlist with sortable columns. Basic metadata comes from Spotify (name, artists, album, duration). Audio features (tempo/BPM, energy, loudness, valence…) come from a third-party source, because **Spotify no longer provides them to apps like this one**. See [§13.4](#134-playlist-studio).
- Charts: distribution of each feature within a playlist, with outliers flagged.
- Move or copy tracks between playlists, for example from a holding playlist into a themed one.
- *Dream:* suggest which themed playlist each holding-playlist track belongs in, by clustering on audio features and naming conventions.

### Later / ideas (not committed)
- Per-scene "stingers": play one track, then return to the previous playlist.
- One-shot sound effects (door slam, thunder, dragon roar) on a pad, using the Milestone 4 engine.
- Share a read-only board with players.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Reliability (top priority)** | Every press runs the [play pipeline](#124-the-play-pipeline): confirm from observed state, use a fallback suited to the failure, then show a visible failure. "Playing" reflects observed state. A [ready check](#126-ready-check-pre-session) runs before each session. |
| Speed | Board click → audio starts within about 1 s on an active device (bounded by Spotify). The UI shows "starting…" at once. Confirmed within 3 s at the 95th percentile on a warm device. Hard deadline of 12 s for confirmed or failed, with the current step shown. |
| Resilience | See [§12.5](#125-auth-robustness) (single-flight, cross-tab token refresh; 6-month re-login), [§12.2](#122-sdk-device-lifecycle) (SDK recovery ladder, run ahead of time on wake) and [§12.7](#127-error-classification) (errors classified by status plus reason). |
| Security | See [research.md §4](research.md#4-q2-how-do-we-handle-authentication-securely): PKCE, `state` check, CSP at build time, no `innerHTML`, no secrets, minimum scopes, a unique origin (D7), pinned CI actions, a committed lockfile. |
| Devices | **Primary: desktop Chrome or Edge** (D8). Firefox and Safari are best effort. A phone as a remote *playback device* is supported. Running the app UI on a phone is not a Milestone 1–2 goal. |
| Accessibility | Keyboard reachable. Visible focus. Tiles have text labels, not only cover art. Works in low-light play conditions (dark theme default). |
| Cost | £0 running cost. Requires Spotify Premium, which the owner already needs. |

## 9. Spotify scopes

| Scope | Needed for | From milestone |
|---|---|---|
| `playlist-read-private` | List private playlists | 1 |
| `playlist-read-collaborative` | List collaborative playlists | 1 |
| `user-read-playback-state` | List devices, read now-playing | 1 |
| `user-modify-playback-state` | Start/pause/transfer, shuffle, repeat, volume | 1 |
| `streaming` | Web Playback SDK | 1b |
| `user-read-email`, `user-read-private` | Required by the Web Playback SDK | 1b |
| `user-read-currently-playing` | Now-playing strip (may be covered by `user-read-playback-state`) | 2, only if needed |
| `playlist-modify-private`, `playlist-modify-public` | Studio: move or copy tracks between playlists | 5, requested only when the Studio is first opened |

## 10. Out of scope

- Editing playlists before Milestone 5. From Milestone 5, only moving or copying tracks between existing playlists.
- Renaming playlists in Spotify. Tag stripping is display-only (see [§13.1](#131-tags-from-playlist-names)).
- Reading the Spotify folder tree. The API does not support it, and reading the desktop app's local cache is fragile.
- Multi-user accounts, sharing, or any server-side storage.
- YouTube as an ambience source (adverts, and its terms forbid separating the audio from the player).
- Analysing Spotify audio ourselves. We cannot access the raw audio: it is DRM-protected, and preview clips are no longer provided.

## 11. Decisions (2026-10-28)

| # | Question | Answer | Effect on design |
|---|---|---|---|
| D1 | Which device plays the audio at the table? | Usually the laptop running the app. Occasionally a separate phone. | ~~"This browser" is the default.~~ **Superseded by D13:** the Spotify desktop app on the laptop is the default; "This browser" is the automatic fallback; a phone is chosen by hand. |
| D2 | Public repo? | Yes, a public repo on Jim's **personal** GitHub account. | The repo is public. Where it is *served from* is D7. |
| D3 | Biggest problem in earlier builds? | **Inconsistency: you press play and nothing happens.** Those builds (about 2021) remote-controlled the **desktop app**, the same path as D13. | Playback reliability is the top non-functional requirement. See [§12](#12-playback-reliability). |
| D4 | Spotify plan? | Full Premium. | The Web Playback SDK and playback control are both available. There is no plan-related blocker. |
| D5 | Do future ideas change the foundations? | No. Tags, quick switch, ambience and Studio all fit the static, no-backend, single-user design. A possible exception is Milestone 5: the features API may need a small proxy if it blocks browser calls (CORS). | Milestone 1 is unchanged. Milestone 2 stores scenes (not bare playlist IDs) and uses hash routing, to leave room for Milestones 4–5. |
| D6 | How are tags written in playlist names? | Colon separator: `Setting: Devil's Office` has tag `Setting`. | Parser splits on the first colon. See [§13.1](#131-tags-from-playlist-names). |
| D7 | Hosting origin | **Cloudflare**, decided 2026-10-28. Deployed as **Workers static assets** (no Worker script), not a Pages project: Cloudflare's create flow now defaults to Workers, and recommends it for new static sites. Production URL: `https://dndplaylistv3.jim-lumsden.workers.dev/`. Config is in `wrangler.jsonc`. | The app gets its own origin instead of sharing `<user>.github.io` with every other Pages site on the account. Each Worker gets its own `*.workers.dev` subdomain, so other Workers on the account are different origins. Real security headers come from `_headers`. £0, deployed from the public GitHub repo. See [research.md §3](research.md#3-q1-where-can-this-be-hosted-for-free). |
| D8 | Primary browser | Chrome or Edge on the laptop. Firefox and Safari are best effort. | Smaller test matrix. Avoids Safari's 7-day storage wipe as a primary risk. |
| D9 | Deploy mechanism | Cloudflare Workers Builds (Git integration). The build command runs the tests; the deploy command is `npx wrangler deploy`, with `wrangler` pinned in `package.json`. GitHub Actions does CI only. | No deploy secrets anywhere. Preview URLs per branch (login doesn't work on previews). Cloudflare Access on the `workers.dev` URL stays **off**: it would add a login wall that can expire mid-session. |
| D10 | Control surface | **Laptop only.** The app UI isn't used on a phone or tablet. | The Board is designed for a laptop screen and keyboard. The layout stays responsive but phone UI is untested and unsupported. A phone is only ever a *playback device*. |
| D11 | How the app runs at the table | As an **installed app window** (Chrome/Edge "Install as app"), alongside Notion, the Spotify app and 5–10 rules tabs. Players can't see the screen. | Milestone 1 ships a web app manifest and icons. Its own window avoids hidden-tab throttling. No spoiler or "player-safe" mode needed. |
| D13 | Default player | **The Spotify desktop app** on the laptop. It's open during every session anyway. | The app is a remote for the desktop app by default. "This browser" (SDK) is an **automatic fallback** when the desktop app isn't listed, with a visible notice. The soak test's main path is the desktop app. Spotify's known SDK bugs move off the main path. |
| D14 | Where a playlist starts | **A random track, then shuffled. Shuffle on.** | The play body carries `offset: { position: random(0, total-1) }`, using the playlist's track count from `GET /me/playlists` (`items.total`). So the *first* track is random even though the shuffle command may arrive late. The app makes sure shuffle is **on** on the target device (§12.4 step 8). If the count isn't available (a followed playlist owned by someone else), it sends no offset and relies on shuffle. |
| D15 | When a playlist runs out | **Repeat the playlist.** Spotify Autoplay is turned off in the desktop app as a one-time setup step. | After confirmation the app sets `repeat=context` alongside shuffle (§12.4 step 8). The Ready check warns if repeat is off. A long scene loops its mood instead of falling silent or drifting into Autoplay's picks. |
| D16 | Milestone 1 scope | **Split.** Milestone 1 is remote control only (desktop app, phone, any listed device). The in-browser player and everything that exists only for it moves to **Milestone 1b**, straight after. | A working, soak-tested main path sooner. The soak test shows whether the desktop app path has its own silent failures before fallback logic is added. Until 1b, a missing desktop app gives a clear "Open Spotify" failure, not an automatic fallback. |
| D17 | Dev environment | **Nix flake** (`flake.nix`, with direnv via `.envrc`) pins Node. Python, if ever needed, uses **uv** from the same flake. | Jim's preference. Any Node 20.19+ also works, so CI and Cloudflare builds don't need Nix. |
| D18 | Milestone 2 slicing | **2a, then 2b.** 2a is the Board workflow: tags, session sets, Board, palette, shortcuts, now playing, routing, export. 2b is the compact strip and the floating-window spike. | The main session workflow arrives sooner. Detailed in [milestone-2a.md](milestone-2a.md). |
| D19 | Session set size | **About 9.** Keys `1`–`9` follow the Board's display order. More are allowed, with a note. | Every tile gets a key and fits on one screen. |
| D20 | Board layout | **Sections by tag.** Sections are ordered by first addition and can be moved up or down. Tiles are dragged within a section. | Matches how Jim names playlists (`Town: …`, `Xanathar: …`). |
| D21 | Now playing | Track and artist, plus **Next**. No volume slider, no cover art. | Volume is set in the Spotify app; the API's volume command is rate-limited and coarse. |
| D22 | Order after Milestone 1 | **2a before 1b**, and before the Milestone 1 soak test, at Jim's request (2026-10-28). | Milestone 1 already works in real use. 1b and the soak test follow 2a. |
| D23 | Board simplification (after first use, 2026-10-28) | **One Board**, no named session sets, no set picker, no JSON export/import. **Space is not a shortcut** (too easy to hit by accident) and is blocked from re-pressing a focused tile. **Untagged playlists are hidden** in the Library and palette by default, with a "Show N untagged" link. The favourite toggle is a labelled button ("Add" / "On Board"), and the Library is a multi-column card grid. Rows show the **song count**. | Jim found the multi-set UI unnecessary. The Board is still saved in this browser's `localStorage`, never on a server (spec §4: no backend). Total duration would need every playlist's tracks fetched, and `/items` only works for playlists Jim owns or collaborates on, so the count is shown instead. |
| D24 | Tag rules config | **`config/tags.json`**, built into the app: `tagRules` add tags to names that match (`contains`, `startsWith` or `regex`, ignoring case, optionally removed from the displayed name), and `hide` rules keep playlists out of the Library and palette. A playlist can have **several tags**: it appears under each in the Library; on the Board it goes in its **first** tag's section (its own `Tag:` first, then rules in file order). The palette shows each playlist once. | Jim wanted all `Theme - …` playlists under Theme as well as their own tag. Keeping it in a repo file means no settings UI, and the rules are versioned and tested. Partly delivers the Milestone 3 overrides and allowlist (§13.1). |
| D25 | Extra tags in names | **`[Tag]` anywhere in a name** adds an extra tag and is hidden from the displayed name, so `Battle: Blades in the Dark [Theme]` is under Battle and Theme. `Tag:` at the start stays the main group. `config/tags.json` remains for rules names can't express (hide rules, transitional matches). | Jim prefers one naming convention he controls in Spotify over per-tag config rules. Renaming is done by Jim in Spotify; the app stays read-only (no `playlist-modify` scope). |
| D26 | Soft transitions | **Fade out (3 s), then the new playlist starts at full volume** (no fade in, after first use). On by default, with a **Fade** toggle. The volume is restored once the new playlist is observed on the device, never before, because Spotify's commands are unordered. Remote devices fade in 5 coarse steps; the in-browser player in 12 local steps. The pre-fade volume is remembered across superseding presses and restored on every failure, pause, resume, next or logout. | Jim's top Milestone 3 request; he then preferred the new music to come straight in. Restoring on every exit path means a failed switch can never leave the music stuck quiet. Detailed in [milestone-3.md](milestone-3.md). |
| D27 | Library and player layout | **Tag pills** above the Library filter it to the selected tags. **Now playing is docked** at the bottom of the main window, larger, with the playlist cover. | Jim found the long Library hard to scan, and wanted the player bar more visually distinct. |
| D12 | Compact mode | **A then B.** (A) A button switches to a docked narrow strip: compact layout, and the window resizes and moves itself to the screen edge. (B) An always-on-top floating strip using Document Picture-in-Picture (Chrome/Edge), tested early in Milestone 2. | A is the reliable baseline. B is the target experience if the spike passes. See [§13.5](#135-compact-mode). |

### Open questions
None currently open.

## 12. Playback reliability

**Main path (D13): the Spotify desktop app, controlled remotely.** Fallback: "This browser" (SDK). Occasional: a phone.

**Goal: a press never fails silently.** Every press ends in one of two visible states. Either the music is confirmed playing, or there is a clear failure message saying what to do next. Changes made after the independent review (2026-10-28) are folded in here.

### 12.1 Likely causes of "press play, nothing happens"

| Cause | Why it is silent | Mitigation |
|---|---|---|
| **The SDK says `ready`, but the Web API doesn't know the device yet.** The first `PUT /play` after `ready` often returns 404 "Device not found" (widely reported). | 404 is treated as fatal or swallowed. | Separate **SDK ready** from **SDK registered**: the device only counts as usable once it appears in `GET /me/player/devices` (§12.2). A 404 on the SDK device is retryable. |
| **The SDK device dies after sleep or tab suspension.** Calls naming it return 502, and `connect()` sometimes stalls instead of recovering. | The app still shows "This browser" as ready. | A **recovery ladder** (§12.2), run *ahead of time* on wake, not when the button is pressed. |
| **The API accepts the command, but nothing plays.** `PUT /me/player/play` returns a 2xx once Spotify has *accepted* the request, not once audio has started. Spotify does not guarantee that player commands run in order. | The 2xx is treated as success. | Confirm from **observed state** (§12.3). Treat 2xx as "accepted" only. |
| **The browser autoplay policy blocks the SDK player.** | No sound, no error. | Call `activateElement()` synchronously in the click handler. Listen for the SDK's **`autoplay_failed`** event and show a large **Click to enable audio** button that calls `activateElement()` and then `resume()`. |
| **A remote device is dormant.** Phone apps drop out of Connect when backgrounded. The desktop app can be listed but inactive after hours idle, or missing after it restarts or updates. | The 404 is swallowed, or no `device_id` is sent. | Always send an explicit `device_id` on play and pause. Refresh the device list before a remote play. If the device is missing: "Open Spotify on your phone, then press again." |
| **Token refresh races.** Several requests hit 401 at once, two tabs refresh together, or React StrictMode exchanges the `?code` twice. Rotated refresh tokens can then be lost. | A random logout mid-session. | Single-flight, cross-tab-locked refresh (§12.5). |
| **The refresh token expires** 6 months after login. Refreshing does not extend it ([Spotify docs](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)). | A forced re-login, possibly at the table. | A countdown warning and a ready check before each session (§12.6). |
| **Two app tabs are open.** That means two SDK devices with the same name. | The command goes to the wrong tab. | A single-instance guard (§12.5). |
| **An ad blocker blocks `sdk.scdn.co`.** | The SDK never loads. | A named failure: "Spotify player blocked. Allow sdk.scdn.co." |

### 12.2 SDK device lifecycle
The SDK player is a **module-level singleton** created outside React, so StrictMode cannot create two. Its states:

`loading → connecting → ready (SDK) → registered (visible in /devices) → [not_ready | error] → recovering → …`

- **Registered:** after `ready`, poll `GET /me/player/devices` (0.5 s, 1 s, 2 s, 4 s) until the device ID appears. Only then show "This browser: ready".
- **device_id:** always use the one from the latest `ready` event. Never cache it across reconnects or page loads.
- **Recovery ladder:** (1) `player.connect()`. (2) If there is no `ready` within 3 s: `disconnect()`, build a new `Spotify.Player`, and connect. (3) If that fails, show **Reload page**.
- **Proactive triggers:** `visibilitychange` (to visible), `online`, a wake detected through timer drift (a 5 s interval that fires more than 30 s late), and the `not_ready` event. Recovery runs *before* the next press, so the press does not pay for it.
- **Error events** map to named states, each with a next step:
  - `initialization_error` → "Browser not supported"
  - `authentication_error` → "Log in again"
  - `account_error` → "Spotify Premium required"
  - `playback_error` → "Playback error, try again"
  - `autoplay_failed` → "Click to enable audio"

### 12.3 Confirmation
- **Match on playlist ID**, parsed from either `spotify:playlist:ID` or the legacy `spotify:user:X:playlist:ID` form. A null `context` counts as "not yet confirmed".
- **Evidence of playing:** the correct device and playlist ID, not paused, **and** progress (the position goes up between two observations, or the track changes).
  - SDK: `player_state_changed` events, plus `player.getCurrentState()`.
  - Remote: `GET /me/player`. A `204` with no body means nothing is active.
- **The tile shows observed state, not a one-time latch.** If confirmation arrives after the tile shows **Failed**, it switches to **Playing**. The app keeps watching for about 10 s after a failure.
- **Confirm windows:** about 3 s for the SDK, about 5 s for remote devices.

### 12.4 The play pipeline
A single **overall deadline of 12 s** applies, and every step respects it. The tile shows the current step ("Waking player…", "Starting…", "Retrying…").

1. **Gesture:** for "This browser", call `activateElement()` synchronously.
2. **Token:** `getAccessToken()` (single-flight refresh, §12.5).
3. **Device:**
   - SDK: if not `registered`, run the recovery ladder within the deadline.
   - Remote: make sure the device was in a device list fetched in the last 30 s; refetch if not.
4. **Command:** `PUT /me/player/play?device_id=<id>` with `{"context_uri": "spotify:playlist:<id>", "offset": {"position": <random>}}` (D14; no offset if the track count is unknown).
   - Any 2xx means accepted. Go to step 5.
   - 404, 502 or 503: back off 250 ms, then 750 ms, then retry once. On the SDK, a second 404 or 5xx triggers a re-register (ladder step 2), then one more command.
   - Other errors: classify (§12.7) and fail.
5. **Confirm** (§12.3).
6. **Fallback, depending on the failure.** At most one re-send per press:
   - SDK accepted but not confirmed: re-register, then re-send.
   - Remote accepted but not confirmed: poll `GET /me/player` again.
     - If it shows **our playlist on our device** but not yet advancing: keep waiting until the deadline. Re-sending would restart it.
     - If it shows **nothing active (204), another device, or a different playlist**: wake the device with `PUT /me/player {"device_ids": ["<id>"], "play": false}`, wait about 1 s, then re-send the play command once. This is the most likely failure of the earlier desktop-app builds (D3).
7. **Result:** **Playing** (observed), or **Failed** with a reason, **Try again** and **Choose another device**.
8. **Playback mode, after confirmation:** if the observed `shuffle_state` is off, send `PUT /me/player/shuffle?state=true&device_id=<id>` (D14). If the observed `repeat_state` isn't `context`, send `PUT /me/player/repeat?state=context&device_id=<id>` (D15). This runs only *after* confirmation, so command order can't scramble the start. The Ready check also sets it.

**Latest press wins:** each press gets an increasing sequence number. Steps from an older press are dropped. Confirmation is checked against the *latest* press's playlist, so if an older command lands late, that shows up as a mismatch and is handled by step 6.

Tile states: `idle → starting(step) → playing | failed`. `failed` can still move to `playing` if late confirmation arrives.

### 12.5 Auth robustness
- **The `?code` callback** is handled once, at module level in `main.tsx` before React renders, never in an effect.
- **Single-flight refresh:** one shared in-flight promise per tab.
- **Cross-tab:** the refresh runs inside `navigator.locks.request('spotify-refresh')`. Inside the lock, re-read `localStorage` first: another tab may already have refreshed. If Spotify returns a new refresh token, store it at once.
- **The SDK's `getOAuthToken` callback** uses the same `getAccessToken()`.
- **Single instance:** a `BroadcastChannel`. A second tab shows "The app is open in another tab. [Use this tab instead]" and does not create an SDK player unless the user chooses to.
- **`invalid_grant` on refresh:** clear auth only, and show a one-click **Log in again**. Preferences stay.

### 12.6 Ready check (pre-session)
A **Ready check** button runs these steps and shows each one green or red:
1. Token valid; days left until re-login is needed (warn when 14 or fewer).
2. SDK registered (or the selected remote device is listed).
3. Plays a playlist on the selected device through the full pipeline, confirms it, then pauses it.
4. Shuffle is on and repeat is `context` on that device after the test play (D14, D15). Warn if not. Also remind: "Is Autoplay off in the Spotify app?" The API can't read that setting, so this is a tick-box.

Run it before players arrive. It reuses the pipeline, so it costs very little to build.

### 12.7 Error classification
Classify by HTTP status **plus** the `error.reason` and `error.message` fields. Status alone isn't enough. Show the raw Spotify message as a fallback.

| Observed | Meaning | User message / action |
|---|---|---|
| 401 | Token expired | Refresh once and retry (silent) |
| 400/401 `invalid_grant` on token refresh | Refresh token expired or revoked | "Log in again" |
| 403 with "Restriction violated" | Command not valid in the current state (for example pausing when already paused) | Re-read the state; usually no message |
| 403 with reason `PREMIUM_REQUIRED`, or SDK `account_error` | Not Premium | "Spotify Premium required" |
| 404 on a play or pause command | Device unknown or not active | Retry (SDK) or "Open Spotify on that device" |
| 429 | Rate limited, possibly `QUOTA_EXCEEDED` | Wait for `Retry-After` up to 30 s. If it is longer: "Spotify quota hit, try again in N min" |
| 5xx | Spotify error | Retry once, then "Spotify is having problems" |

The client accepts **any 2xx** and never requires a JSON body. Empty bodies and non-JSON text bodies both count as success: on 2026-10-28, `PUT /me/player/play` with a `context_uri` returned 200 with a plain-text body, while pause and resume returned empty bodies.

### 12.8 Diagnostics
- An in-memory **event log** of the last 200 events: API calls (method, path, status, duration), SDK events, pipeline steps and device lifecycle changes, with timestamps.
- **Hygiene:** strip query strings from every logged URL. Never log request or response bodies from `accounts.spotify.com`, and never log tokens or the `Authorization` header.
- A **debug panel** (opened with `?debug` or a small "Log" link) with **Copy log**, and developer actions: **Expire access token now**, **Simulate 401 on next request**, **Kill SDK player**. These make the recovery paths testable by hand.
- No log data is sent anywhere.

### 12.9 Quota awareness
A press costs 1 command, up to about 4 confirmation polls for a remote device, and up to 4 device-registration polls after an SDK reconnect. That is a few calls per scene change, well within quota.

## 13. Future features: design notes

These are not committed designs. They record enough thinking that the early milestones don't close off any of them.

### 13.1 Tags from playlist names
- **Source of truth stays in Spotify.** The tag is already part of each playlist name. The app parses it at display time and never renames anything. That way the tags keep working in the Spotify app itself, and no tag data needs to be stored or synced.
- **Convention (decision D6):** `<Tag>: <Short name>`, for example `Setting: Devil's Office` → tag `Setting`, short name `Devil's Office`.
- **Parser:** one function, `parsePlaylistName(name) → { tag, shortName }`:
  - Split on the **first** colon only. Trim whitespace on both sides. `Setting: Hell: Lower Circle` → tag `Setting`, short name `Hell: Lower Circle`.
  - Group tags case-insensitively (`setting` and `Setting` are the same group). Display the most common spelling.
  - No colon, or an empty part on either side (`Setting:` or `: Foo`) → **Untagged**, shown under the full original name.
  - A colon in a name that isn't a tag (for example a soundtrack called `Star Wars: Battle Music`) gets parsed as tag `Star Wars`. An optional **known-tags allowlist** in settings fixes this: when set, only listed prefixes count as tags and everything else is Untagged. Milestone 3 also adds per-playlist overrides.
- Unit tests cover every case above.
- **Display:** the Library and the quick-switch palette group by tag, then sort by short name. Board tiles show the short name, with the tag as a small label or colour.
- **Why not rename in Spotify?** It would need write scopes, would lose the grouping inside the Spotify app, and the tags would then have to live somewhere else (in this app's storage, or in each playlist's description). We can reconsider in Milestone 5, but it isn't needed.

### 13.2 Reaching non-selected playlists mid-session
- The Board stays focused on the session set, but the **whole library is always one key away**. `/` or `Ctrl/Cmd+K` opens a palette with instant fuzzy search over short names and tags, grouped by tag. Arrow keys and `Enter` play the result.
- There is also a visible "All playlists" button for mouse use.
- After playing from the palette, a small "Add to set" action pins the playlist to the current session set.
- The library list is fetched at login and cached in memory (and in `localStorage` with a timestamp), so the palette opens instantly with no API call.

### 13.3 Ambience mixer
- **Why a separate source:** one Spotify account can only play one stream at a time, so ambience cannot come from Spotify. **YouTube is ruled out**: it has adverts, a visible player is required, and its terms forbid separating the audio from the player.
- **Engine:** Web Audio API. Each layer is an `AudioBufferSourceNode` with `loop = true` (gapless, unlike `<audio loop>`), feeding a per-layer `GainNode`, then a master ambience `GainNode`, then the speakers. Fade layers in and out with `linearRampToValueAtTime` to avoid clicks.
- **Same tab as the SDK player:** the Spotify music (Web Playback SDK) and the ambience mix are separate audio outputs in the same page. Their volumes are independent.
- **Autoplay:** the `AudioContext` is resumed inside a click handler, the same rule as the play pipeline in §12.
- **Where the sound files come from** (decided by a spike, see [research.md §7.1](research.md#71-ambience-sound-sources)). There are two candidate approaches, which can be combined:
  1. **Bring your own folder:** pick a folder of sound files on the laptop. The app stores them in IndexedDB. This avoids every redistribution and licensing question, because nothing is published.
  2. **Bundled starter pack:** a small set of CC0 loops committed to the repo and served with the app. Only CC0 files, or CC-BY files with an attributions page.
- **Format:** Ogg Opus or AAC, about 1–3 minutes per loop, trimmed at zero crossings so the seam is inaudible.
- **CSP:** add `media-src 'self' blob:` when this milestone lands.
- **Scenes:** a scene can store `{ layerId, volume }[]`. Pressing the scene starts the playlist through the play pipeline and cross-fades the ambience to the preset.

### 13.4 Playlist Studio
- **Blocker found in research:** Spotify's audio-features and audio-analysis endpoints (tempo, energy, loudness, valence, danceability…) return **403 for apps created after 27 Nov 2024 or in Development Mode** ([Spotify blog](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)). Community reports say it will not be restored; Spotify itself offers no replacement. Track preview clips were removed for new apps at the same time, and full track audio is DRM-protected. So **we cannot get or compute these features from Spotify**.
- **Plan:** fetch features from a third-party catalogue keyed by Spotify track ID, behind a swappable `FeatureProvider` interface with a permanent IndexedDB cache. There are two candidates, compared in [research.md §7.2](research.md#72-audio-features-for-the-playlist-studio):
  - **ReccoBeats:** free, no key, Spotify-*style* values.
  - **Spotify Extended Audio Features API** (musicae, on RapidAPI): claims Spotify's original values. Free for 50 tracks a day, or $9.99/month for bulk. It needs a secret RapidAPI key, which you enter in settings and which is stored only in your browser.
  
  The spike compares coverage, accuracy and browser access (CORS) on the same 50 tracks. If neither allows browser calls, we would need a tiny Cloudflare Worker proxy: the first and only server piece, and an exception to principle 4.
- **No beat or section analysis:** neither candidate replaces Spotify's audio-analysis endpoint, so Studio works with track-level features only.
- **Spotify data we *can* read:** playlist items for playlists you own or collaborate on (`GET /playlists/{id}/items`), with name, artists, album and duration. Moving tracks uses `POST`/`DELETE /playlists/{id}/items` with the Milestone 5 write scopes.
- **Analysis runs in the browser:** sortable table, per-playlist distributions, z-score outlier flags, and k-means clustering on normalised features plus keywords from track and playlist names. A few thousand tracks is easily handled client-side. Features are cached in IndexedDB so each track is fetched once.
- **Terms check needed:** before building clustering or suggestions, re-read the Spotify Developer Terms on analysing Spotify content and on machine learning. Confirm that "group my own tracks by third-party features" is allowed.

### 13.5 Compact mode
- **(A) Docked strip, Milestone 2 baseline.** A **Compact** button (and a shortcut) switches to a strip layout: session-set tiles stacked vertically, the playing state, and Pause. In an installed app window it calls `window.resizeTo(360, screen.availHeight)` and `moveTo()` to the right edge, then restores the previous size and position on **Expand**. In a normal tab, it only changes the layout.
- **(B) Floating strip, Milestone 2 spike.** A **Float** button calls `documentPictureInPicture.requestWindow({ width: 360, height: 640 })` and renders the strip into that window. It is always on top, so it floats over Notion. The main window can then be minimised. To test in the spike:
  1. Does clicking a tile in the floating window count as a user gesture for `activateElement()` and audio?
  2. Do keyboard shortcuts work while it has focus?
  3. What happens when the main window is minimised for a long time: is the SDK still throttled?
  4. Closing the main window closes the floating one: make that obvious.
  5. Does it survive sleep and wake?
- **Shared code:** both modes render the same `<Strip>` component from the same state, so B costs little once A exists.


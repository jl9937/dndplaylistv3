# Research: platform, hosting, auth and framework

Status: complete for Milestone 1 · Last checked: 2026-10-28

This document answers the three pre-build questions and records the Spotify platform constraints that shape the design. Spotify has changed its developer platform a lot since 2024, so earlier builds of this idea may no longer work as they did.

---

## 1. Spotify platform constraints (read this first)

These facts drive most of the decisions below.

| Constraint | What it means for us | Source |
|---|---|---|
| **Development Mode apps need the app owner to hold Spotify Premium.** If Premium lapses, the app stops working until it resumes. | Fine for a personal tool. Playback control needs Premium anyway. | [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [TechCrunch](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/) |
| **Development Mode allows at most 5 authorised users per app** (down from 25). Extended quota is effectively out of reach for hobby apps. | This is a single-user (or few-user) tool. You must add your own Spotify account email to the app's user list in the dashboard. Do not plan for public use. | Same as above |
| **API quotas are counted per developer account** (July 2026). A 429 response now includes `"reason": "QUOTA_EXCEEDED"`. | Cache the playlist list. Do not poll aggressively. | [July 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/july-2026) |
| **The implicit grant flow is gone** (since 27 Nov 2025). | Use Authorization Code with PKCE. | [OAuth migration reminder](https://developer.spotify.com/blog/2025-10-14-reminder-oauth-migration-27-nov-2025) |
| **Redirect URIs must be HTTPS.** The only HTTP exception is loopback IP literals (`127.0.0.1`, `[::1]`). The name `localhost` is **not** allowed. | Local dev runs on `http://127.0.0.1:5173/`, not `localhost`. Production needs an HTTPS host. | [Security requirements blog](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify), [Redirect URI docs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) |
| **The Web API does not return playlist folders.** `GET /me/playlists` returns a flat list. | We cannot show your Spotify folder tree. This is a reason to build the app: our own grouping (tags, "session sets") replaces folders. | [Playlists concept docs](https://developer.spotify.com/documentation/web-api/concepts/playlists) |
| **`GET /me/playlists` returns owned and followed playlists only.** Private ones need `playlist-read-private`; collaborative ones need `playlist-read-collaborative`. Spotify's algorithmic playlists ("Daily Mix", etc.) are not returned. | Request both scopes. Paginate: the page limit is 50 and you have dozens of playlists. | Same as above |
| **`GET /users/{id}/playlists` was removed. `/playlists/{id}/tracks` was renamed to `/playlists/{id}/items`** and only works for playlists you own or collaborate on. | We only need the playlist URI to start playback, so we do not have to read tracks in Milestone 1. Use the new names if we read tracks later. | [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) |
| **Playback control (`PUT /me/player/play`, transfer, devices) needs Premium.** The migration guide lists no changes to player endpoints. | Core of the app. Works with any Spotify Connect device: desktop app, phone app, or an in-page Web Playback SDK player. | Same as above |

**Unverified:** One community report says the developer dashboard rewrote `127.0.0.1` redirect URIs to `localhost` on save. Check the saved value after you register it.

---

## 2. How the music plays: three options

The web app should *control* playback. Spotify does the playing. There are three ways to do that.

### Option A: Spotify Connect remote control (Web API)
The app calls `PUT /me/player/play` with `{"context_uri": "spotify:playlist:…"}` and a `device_id`. Any running Spotify client (desktop app, phone, smart speaker) plays the music.
- **Pros:** Simplest. Best audio reliability. Works when the app runs on a phone or tablet and music plays from a laptop or speaker.
- **Cons:** A Spotify client must be open and recently active, or it will not appear in `GET /me/player/devices`.

### Option B: Web Playback SDK (in-page player)
The page loads Spotify's SDK, which registers the browser tab as a Connect device. We then use Option A's API calls with that tab's `device_id`.
- **Pros:** No other app needed. The page is the player.
- **Cons:** Needs Premium (not mobile-only plans like Lite/Mini) and the `streaming`, `user-read-email` and `user-read-private` scopes. Mobile browsers have autoplay and background-play limits. On iOS a user gesture is needed to start audio.
- [SDK docs](https://developer.spotify.com/documentation/web-playback-sdk), [Quick start](https://developer.spotify.com/documentation/web-playback-sdk/quick-start)

### Option C: Embed iFrame API
Drop a Spotify embed into the page and call `controller.loadEntity(uri)` / `play()`.
- **Pros:** No OAuth needed for the player itself.
- **Cons:** Full tracks play only in a desktop browser that is logged in to spotify.com with Premium. Otherwise it plays 30-second previews (community-reported, not officially documented). It has no shuffle or repeat control, and autoplay is not guaranteed. We still need OAuth to list your playlists.
- [iFrame API reference](https://developer.spotify.com/documentation/embeds/references/iframe-api)

**Recommendation:** Build on **A + B together**. They use the same API call, so the in-page SDK player is just one more entry in the device list. Milestone 1 defaults to "This browser" (SDK) and offers any other active Spotify device as an alternative.

**Decided:** audio usually plays from the laptop running the app (B is primary). It occasionally plays from a separate phone (A is secondary). Option C is a fallback only if the SDK proves unreliable.

---

## 3. Q1: Where can this be hosted for free?

The app can be a **pure static site**. PKCE works without a server, so there is no backend to host. Every static host below is free and gives HTTPS.

| Host | Free? | HTTPS | Custom headers (CSP etc.) | Deploy | Notes |
|---|---|---|---|---|---|
| **GitHub Pages** | Yes (public repo) | Yes, `*.github.io` | **No.** CSP only via `<meta>` tag | GitHub Actions on push | Closest to where the code lives. Private repos need a paid plan. No SPA routing, so avoid deep links (see below). |
| **Cloudflare Pages / Workers static assets** | Yes, generous | Yes, `*.pages.dev` | Yes, via `_headers` file | Git integration or `wrangler` | Best security headers. One more account to manage. |
| Netlify | Yes (limited build minutes) | Yes | Yes, `_headers` / `netlify.toml` | Git integration | Fine alternative. |
| Vercel | Yes (Hobby, non-commercial) | Yes | Yes, `vercel.json` | Git integration | Skews toward Next.js. Overkill here. |

**Original recommendation: GitHub Pages**, deployed by a GitHub Actions workflow from `main`. **Revised after review: Cloudflare (decided, spec D7)**, deployed as Workers static assets rather than a Pages project. The reason is below.
- **Decided:** a public repo on Jim's personal GitHub account.
- **Shared-origin problem:** every project site on an account is served from the *same origin*, `https://<user>.github.io`. `localStorage`, IndexedDB and service-worker scope are per origin. So **any other Pages site on the account can read this app's refresh token and data**, and a user-site repo could register a root service worker over this app's path. This app's own CSP can't prevent that. GitHub Pages is only safe if no other Pages site on the account runs untrusted or third-party code, now or in future.
- **Alternative: Cloudflare Pages** (`dnd-playlist-manager.pages.dev`). Its own origin, real HTTP security headers through `_headers` (so a full CSP including `frame-ancestors`), £0, and it deploys from the same GitHub repo. The cost is one extra free account.
- The repo can be public. Nothing secret is in it: the Spotify **Client ID is public by design**, and PKCE needs no client secret.
- Use the **app root as the redirect URI** (`https://<user>.github.io/dnd-playlist-manager/`). The app then reads `?code=` on load. This avoids the GitHub Pages 404 problem with SPA routes like `/callback`.
- On GitHub Pages, CSP can only be a `<meta>` tag, injected **at build time only**: the Vite dev server needs inline scripts and styles plus a websocket for hot reload, which a strict CSP blocks. A meta CSP can't set `frame-ancestors`. On Cloudflare Pages the same policy goes in `_headers`.

"Self-hosted" for Milestone 1 can mean **running locally** (`npm run dev` on `http://127.0.0.1:5173/`) before we set up the GitHub Pages deploy. Both redirect URIs can be registered on the same Spotify app.

---

## 4. Q2: How do we handle authentication securely?

**Use Spotify's Authorization Code flow with PKCE, entirely in the browser.** This is Spotify's recommended flow for public clients that cannot keep a secret ([security requirements](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify)).

### Flow
1. The user clicks **Log in with Spotify**.
2. The app generates a random `code_verifier` (64+ chars, from `crypto.getRandomValues`), derives `code_challenge = base64url(SHA-256(verifier))`, and generates a random `state`. Both are stored in `sessionStorage`.
3. The app redirects to `https://accounts.spotify.com/authorize` with `client_id`, `response_type=code`, `redirect_uri`, `scope`, `state`, `code_challenge_method=S256`, `code_challenge`.
4. Spotify redirects back to the app root with `?code=…&state=…`.
5. The app checks that `state` matches, then POSTs to `https://accounts.spotify.com/api/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`.
6. The app receives an `access_token` (about 1 hour) and a `refresh_token`. It strips `?code` from the URL with `history.replaceState`. The callback is handled once, at module load before React renders, so StrictMode can't exchange the code twice.
7. Before expiry, or on a 401, the app refreshes with `grant_type=refresh_token`. It stores the new refresh token if Spotify returns one. Refresh is single-flight within a tab and locked across tabs (spec §12.5).
8. **Refresh tokens last 6 months from login, and refreshing does not extend that** ([Spotify docs](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)). The app records the login date, warns 14 days ahead, and handles `invalid_grant` with a one-click re-login.

### Security rules
- **No client secret anywhere.** Not in the repo, not in the build, not in env vars.
- **Minimum scopes.** See the Milestone 1 spec for the exact list. Add scopes only when a feature needs them.
- **Validate `state`** on every callback. Clear the verifier after one use.
- **Token storage:** Keep the access token in memory. Keep the refresh token in `localStorage` so you do not have to log in again at every session. This is a deliberate trade-off. It is acceptable because:
  - the app loads no third-party scripts except Spotify's SDK, which keeps the XSS attack surface small;
  - a strict CSP limits `script-src` to `'self'` and `https://sdk.scdn.co`, and `connect-src` to the Spotify API and accounts hosts. Its job is to **block script injection**. It cannot contain a breach once a script is running: an injected script could still leak a token through a top-level navigation;
  - the app is served from an origin no untrusted code shares (spec D7);
  - CI actions are pinned to commit SHAs, the lockfile is committed, and `npm ci` is used. A compromised dependency is the realistic route for injected script;
  - we never render untrusted HTML. Playlist names are rendered as text, never with `innerHTML` or `dangerouslySetInnerHTML`. Descriptions (which Spotify returns HTML-escaped, sometimes with `<a>` tags) are not shown in Milestone 1. If shown later, they are decoded and tag-stripped with `DOMParser`, then rendered as text.
  - A **Log out** button clears all stored tokens (`auth.*` keys only; preferences and session sets are kept). Access can also be revoked at spotify.com → Account → Apps.
- **Redirect URIs** registered in the Spotify dashboard must match exactly: one for local dev, one for production. Nothing else.
- **Users:** Add only your own Spotify account (and at most four others) under *User Management* in the dashboard.

### Why not a backend?
A backend (for example a Cloudflare Worker holding tokens in an HttpOnly cookie) would keep the refresh token away from page JavaScript. That is stronger, but it adds a server, a secret and a deploy target. For a single-user tool with strict CSP, the browser-only PKCE flow is proportionate. We can revisit this if the app ever gets more users.

---

## 5. Q3: Which framework?

Goals: as simple as possible, quick to develop, flexible enough for later features (session sets, quick-switch board, maybe crossfade and keyboard shortcuts).

| Option | Simplicity | Flexibility | Verdict |
|---|---|---|---|
| Plain HTML + JS, no build | Highest at first | Becomes messy as UI state grows | Too thin for later milestones |
| **Vite + React + TypeScript** | High: one `npm create vite`, static output | Very high: biggest ecosystem, easy to find help and examples | **Recommended** |
| Vite + Svelte + TypeScript | High, less boilerplate than React | High, smaller ecosystem | Good alternative if you prefer Svelte |
| Next.js / Remix / SvelteKit | Medium: server concepts we do not need | High | Overkill for a static SPA |

**Recommendation: Vite + React + TypeScript**, built to static files.
- **No router** in Milestone 1. The app has two states: logged out and logged in.
- **No state library.** React state plus a small `spotify` client module is enough.
- **No Spotify SDK wrapper package.** The API surface we need is about six endpoints. A thin typed `fetch` wrapper avoids depending on community libraries that may lag behind the 2026 API renames.
- **No component library** for Milestone 1. Plain CSS. We can add one later if the UI grows.
- **Tests:** Vitest for the auth helpers (PKCE, token refresh logic) and the API client.

---

## 6. Open risks to check in a spike

0. **Silent play failures** (the biggest problem in earlier builds, which remote-controlled the desktop app around 2021). Measure this with the soak test in the [Milestone 1 definition of done](milestone-1.md#definition-of-done). The design that addresses it is in [spec §12](spec.md#12-playback-reliability).
   - Known SDK issues (community-reported): a 404 on the first play after `ready`, and a 502 or a stalled `connect()` after standby ([thread 1](https://community.spotify.com/t5/Spotify-for-Developers/Spotify-Web-Playback-SDK-404-device-not-found/td-p/5472057), [thread 2](https://community.spotify.com/t5/Spotify-for-Developers/Spotify-Web-Playback-SDK-New-race-condition-Player-not-ready-on/td-p/5464378)).
   - The SDK streams and decrypts audio inside its own cross-origin iframe (`sdk.scdn.co`), which follows its own CSP. The parent page probably needs only `script-src` and `frame-src https://sdk.scdn.co`. Confirm this in the spike.
   - `GET /me` no longer returns `email`, `product` or `country` (Feb 2026), so the app can't check Premium status up front. The SDK's `account_error` is the signal.
1. The Web Playback SDK device must show up and accept `PUT /me/player/play` in your browser of choice (desktop Chrome/Firefox/Safari).
2. How long a desktop Spotify app stays visible in `GET /me/player/devices` when idle.
3. The redirect URI must save in the dashboard as `127.0.0.1`, not get rewritten to `localhost`.
4. How the quota behaves with a few dozen playlists. This is expected to be fine: one paginated fetch per load.

### Spike notes (Milestone 1, live)
- **2026-10-28, first production login:** login (PKCE, workers.dev redirect), the library (148 playlists, paginated) and device listing (the MacBook Pro desktop app, listed as `Computer`, active) all worked first time. Pause and resume worked.
- **`PUT /me/player/play` with a `context_uri` returns 200 with a plain-text body** (an opaque ID-like string), not an empty body. The first build parsed every non-empty 2xx body as JSON, so it threw and showed a false **Failed**. Fixed: the client never requires JSON on a 2xx (spec §12.7).

---

## 7. Later milestones research

Status: initial desk research (2026-10-28). Each part needs a hands-on spike before its milestone starts.

### 7.1 Ambience sound sources

Requirements: free, high quality, loopable, layerable with per-layer volume, no adverts, legal for a personal home game.

| Source | Licence (as found) | Fit | Notes |
|---|---|---|---|
| **Freesound.org** | Per file: CC0, CC-BY or CC-BY-NC. The API is free for non-commercial use, with a key. | **Strong**, as a place to *find* loops | Huge library with many seamless ambience loops. Filter to CC0 to avoid attribution work. The API terms limit cached copies, so it's best to download hand-picked files rather than stream from the API at runtime. [API terms](https://freesound.org/help/tos_api), [developers](https://freesound.org/help/developers) |
| **Tabletop Audio** ambiences | CC BY-NC-ND 4.0 | **Good** for personal use | 500+ 10-minute RPG ambiences, made for exactly this use. "ND" restricts *sharing* adapted versions. Trimming them privately in your own folder is fine, but edited copies must not be committed to the public repo. Their **SoundPad** sounds are not licensed for use outside their site. No API. [About/licence](https://tabletopaudio.com/about.html) |
| Sonniss GDC bundles | Royalty-free for use in productions. **Redistribution unverified** | Possible for "bring your own folder" | Very high quality. Do not commit to a public repo unless the licence clearly allows it. |
| BBC Sound Effects | RemArc licence: personal, educational and research use | Possible for "bring your own folder" | Do not redistribute. |
| YouTube | Terms forbid separating the audio from the player. Adverts. | **Rejected** | Also needs a visible player per layer. |
| Paid: Syrinscape, Tabletop Audio Patreon | Commercial | Out of scope (£0 goal) | Worth knowing about as a benchmark for features. |

**Leaning:** "bring your own folder" as the main mechanism, with files you download yourself from Freesound (CC0) and Tabletop Audio. Plus, optionally, a small CC0 starter pack in the repo. Spike tasks: curate about 10 core layers (water, river, rain, wind, fire, crowd/tavern, forest, cave drips, city, sea), check that the loops are seamless, and check the total size.

### 7.2 Audio features for the Playlist Studio

- **Spotify:** `GET /audio-features` and `GET /audio-analysis` return **403** for apps registered after 27 Nov 2024 and for Development Mode apps. Community reports say Spotify will not restore them. Preview URLs were removed at the same time. [Spotify blog, Nov 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api), [community thread](https://community.spotify.com/t5/Spotify-for-Developers/Web-API-Get-Track-s-Audio-Features-403-error/td-p/6654507)
- **ReccoBeats:** free and keyless, serving Spotify-style features (tempo, energy, valence…), with lookup by Spotify ID. Its audio-features endpoint may need its own UUID first, from a track lookup. It returns 429 with `Retry-After` when throttled. Coverage, accuracy and CORS are **unverified**. [API listing](https://apis.io/apis/reccobeats/reccobeats-audio-features-api/)
- **Spotify Extended Audio Features API** (by musicae, sold on RapidAPI). [Listing](https://rapidapi.com/musicae-musicae-default/api/spotify-extended-audio-features-api), read 2026-10-28:
  - **What:** a drop-in copy of Spotify's deprecated `GET /v1/audio-features/{id}` and `?ids=` (**max 5 IDs per call**), in the same JSON shape. It takes 22-character Spotify IDs. It also offers recommendations, related artists, catalog and search. There is **no audio-analysis endpoint** (sections, beats, segments).
  - **Data source:** the vendor says the values "are Spotify's own reported audio features, served from our index". That makes them directly comparable with old Spotify data. But it is a *copy* of Spotify data: tracks released after Spotify cut access may be missing, and the service could be taken down. Unverified.
  - **Auth:** a RapidAPI key in `X-RapidAPI-Key` and `X-RapidAPI-Host` headers. **This key is a secret**, unlike the Spotify Client ID.
  - **Pricing (as listed):**

    | Plan | Price | Requests |
    |---|---|---|
    | Basic | $0 | 10 a day (hard limit) |
    | Pro | $9.99/mo | 10,000 a month |
    | Ultra | $29.99/mo | 100,000 a month |

    RapidAPI's FAQ suggests a card may be needed even for the free plan.
  - **Fit for us:** the free plan covers **50 tracks a day** (10 calls × 5 IDs). About 1,500 tracks would take about a month to backfill. One month of Pro (about 50,000 tracks) would do it at once, after which only new tracks need fetching. Features don't change, so cache them in IndexedDB indefinitely.
  - **Unknowns for the spike:** coverage of your tracks; whether RapidAPI allows calls from a browser (CORS); whether values match known Spotify values.
- **Other paid or limited options:** Cyanite, getsongbpm.com, MeloData. Vendor blog claims about them are unverified.

**Comparison of the two leading candidates:**

| | ReccoBeats | Spotify Extended Audio Features (musicae) |
|---|---|---|
| Cost | Free | Free: 50 tracks a day. Pro: $9.99 a month |
| Key | None | RapidAPI key (secret) |
| Values | Spotify-*style* (provenance unclear) | Claimed to be Spotify's original values |
| Batch | Unverified | 5 per call |
| Audio analysis | No | No |
| Biggest risk | Coverage and accuracy | Data provenance and takedown; key handling |

**Design consequence:** put a `FeatureProvider` interface behind an IndexedDB cache, so the provider can be swapped (or several combined) without touching the Studio UI. A RapidAPI key would be **entered by you in the app's settings** and stored only in your browser. It must never be committed or built into the app. That's acceptable for a single-user tool on a unique origin (D7). Anything shared would need a proxy.
- **Computing features ourselves** (Essentia, librosa) is **not possible**: we have no access to Spotify audio.

Spike tasks: run the same 50 track IDs from your playlists through **both** ReccoBeats and the musicae API (50 tracks is exactly one day of musicae's free plan). Measure coverage (the % of tracks with features), compare the BPM and energy values between the two and against tracks you know, and test a browser `fetch` to each for CORS.

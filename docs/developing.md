# Developing

How to pick this app up again: where things are, how to check a change, how it ships, and the conventions it was built with. For *what* it does and *why*, read the spec.

## Read first

1. [README](../README.md): setup, how each feature is used, and **Known limitations** (what isn't done).
2. [spec.md §11](spec.md#11-decisions-2026-10-28): decisions **D1–D36**, each with its reason. Check here before changing behaviour: most "odd" choices are deliberate, and the reason is recorded.
3. The milestone docs ([1](milestone-1.md), [1b](milestone-1b.md), [2a](milestone-2a.md), [2b](milestone-2b.md), [3](milestone-3.md), [4](milestone-4.md), [5](milestone-5.md)): acceptance criteria and technical design per feature.
4. [research.md](research.md): Spotify's 2025–26 platform limits, and the measurements behind the Studio (§7.2).

## The code, as built

A static single-page app (Vite, React 19, TypeScript, plain CSS). No backend: everything runs in the browser and talks to Spotify directly. Logic lives in plain modules outside React, so it can be tested; `src/ui/` is the React layer on top.

| Folder | What's in it |
|---|---|
| `src/main.tsx` | Entry. Handles the login callback once, runs the owner check, then renders `App`. |
| `src/App.tsx` | The shell: header, routes (`#/board`, `#/library`, `#/ambience`, `#/studio`), the player dock, the strip modes. |
| `src/auth/` | `auth.ts`: PKCE login, token refresh (single-flight, cross-tab lock), logout. `owner.ts`: the owner lock (D35). `pkce.ts`: verifier and challenge. |
| `src/spotify/` | `client.ts`: the fetch wrapper (auth header, 401 → refresh → retry, error classification, 429 waits); it only ever sends the token to `api.spotify.com`. `api.ts`: typed calls. `types.ts`: only the fields used. `uri.ts`: playlist IDs from URIs. |
| `src/playback/` | `pipeline.ts`: **the play pipeline**, from a press to a confirmed "Playing" or a visible failure (spec §12). `device.ts`, `devices.ts`, `fallback.ts`: devices and the automatic fallback to "This browser". `fader.ts`: fade out (D26). `nowPlaying.ts`: polls what Spotify is doing. `playback.ts`: the one entry point for play, pause and next. `readyCheck.ts`. `skipRemove.ts`: Skip & remove, and remove/restore with positions. |
| `src/player/` | The Web Playback SDK ("This browser"): lifecycle, recovery, one tab only. |
| `src/library/` | `libraryStore.ts`: playlists, cached. `tags.ts`: tags from names (`Tag:` and `[Tag]`), grouping, add/remove a tag. `tagConfig.ts`: `config/tags.json`. `tagColour.ts`. `search.ts`: the palette's fuzzy search. |
| `src/board/` | The Board: scenes, sections, ambience presets, validated storage. |
| `src/ambience/` | The Web Audio mixer (looping layers, fades, presets) and the sound list, found at build time in `ambience/`. |
| `src/studio/` | `reccobeats.ts` + `featureCache.ts`: audio features. `outliers.ts` + `outlierScan.ts`: outlier review. `recommend.ts`: playlist suggestions and their measurement. `filing.ts`: copy into a playlist / undo without duplicates. |
| `src/diagnostics/log.ts` | The in-memory event log (200 events, scrubbed of tokens and query strings), shown by **⋯ → Log** or `?debug`. |
| `src/storage.ts` | Namespaced localStorage: `auth.*` (tokens), `cache.*` (library, features), `prefs.*` (settings), `sets.*` (the Board). Logout clears `auth.*` and `cache.*`. |
| `src/ui/` | The screens and parts: `Board`, `Library`, `Studio` (+ `Sorter`), `Ambience`, `PlayerBar`, `DevicePicker` (+ `DeviceButton`), `SkipRemove`, `TagPicker`, `Palette`, `Strip`, `Menu`, … |
| `src/styles.css` | All styles. Colours are the tokens at the top (`--bg`, `--panel`, `--accent`, `--ok`, `--warn`, `--bad`, …). |
| `public/_headers` | Security headers and the **CSP**, served in production only. Adding an outside host (an API, a script) means adding it here too. |
| `config/tags.json` | Tag rules and hide rules (README → Tags). |
| `ambience/` | The sound files and their credits; see its README. `scripts/make_ambience_loops.py` turns downloads into matched, seamless loops. |
| `tests/` | Vitest. `helpers.ts`: `seedTokens`, `stubFetch`, `json`. `setup.ts`: an in-memory localStorage, reset per test. |

## Checking a change

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

- **Unit tests** cover the logic modules: the pipeline, auth, the client, devices, tags, the Board, ambience (with a fake AudioContext), the SDK lifecycle (with a fake SDK), the Studio. New logic gets tests; inject dependencies (`deps`) rather than mocking modules.
- **Dead code:** `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` should be clean.
- **Local dev** (`npm run dev`, <http://127.0.0.1:5173/>) can log in for real if `.env` has the Client ID and the 127.0.0.1 redirect URI is registered (README → Local development). Use `127.0.0.1`, never `localhost`.

### Checking the UI without logging in

Every screen in Milestones 4–5 and the UI redesign was checked this way: run the dev server, then, in the browser's console (or a browser automation tool), fake a login, stub Spotify's replies, and render the real `App`:

```js
localStorage.setItem('auth.tokens', JSON.stringify({
  accessToken: 'FAKE', refreshToken: 'R', expiresAt: Date.now() + 3600000, loginAt: Date.now(),
  scope: 'streaming user-read-email user-read-private playlist-modify-private playlist-modify-public',
}));
localStorage.setItem('prefs.device', JSON.stringify({ name: 'MacBook Pro', type: 'Computer' }));
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const u = String(input);
  const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('reccobeats')) return j(200, { content: [] });
  if (!u.includes('api.spotify.com')) return realFetch(input, init);
  if (u.endsWith('/me')) return j(200, { id: 'jim' });
  if (u.includes('/me/playlists')) return j(200, { items: [/* playlists */], next: null, total: 0 });
  // …playlist items, devices, /me/player as needed; record writes (init.method) to check them
  return j(204, {});
};
const React = await import('/node_modules/.vite/deps/react.js').then((m) => m.default ?? m);
const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js').then((m) => m.default ?? m);
const { App } = await import('/src/App.tsx');
document.body.innerHTML = '<div id="root2"></div>';
location.hash = '#/studio';
ReactDOM.createRoot(document.getElementById('root2')).render(React.createElement(App, { callback: { kind: 'none' } }));
```

Single components can be rendered the same way (`import('/src/ui/Sorter.tsx')`). Make the stub stateful (keep each playlist's items in an object, apply `POST`/`DELETE`) to check flows like Copy → Undo end to end. **Afterwards, run `localStorage.clear()`**, so the fake login doesn't linger. With `VITE_SPOTIFY_OWNER_ID` set locally, the stubbed `/me` must return that ID.

## How it ships

1. **Push to `main`.** Only push when Jim has said so.
2. **GitHub Actions CI** (`.github/workflows/ci.yml`): `npm ci`, typecheck, tests. Actions are SHA-pinned.
3. **Cloudflare Workers Builds** deploys on every push to `main`: `npm ci && npm test && npm run build`, then `npx wrangler deploy` (static assets only, no Worker script; `wrangler.jsonc`). Build variables: `VITE_SPOTIFY_CLIENT_ID` and `VITE_SPOTIFY_OWNER_ID`. Vite bakes them in, so a changed value applies from the next deploy.
4. **Check it's live:** the build ID (commit + build time) is in **⋯ → Log**. An open window keeps the old build until it's reloaded (Cmd+Shift+R).
5. **Releases:** bump `version` in `package.json` and `package-lock.json`, then tag the deployed commit `vX.Y.Z` (annotated) and publish a GitHub release with notes. v1.0.0 was the first.

## Conventions

- **Decisions** get the next **D-number** in spec §11 (question, answer, effect on the design), and comments in the code cite them (`// … (D29)`). To reverse one, add a new decision that supersedes it, and say so in the old one.
- **Features** get a milestone doc: goal, decisions, user stories with acceptance criteria, technical design, definition of done. Spikes and measurements go in research.md.
- **Writes to Spotify** (remove, copy, rename) must: act only on playlists Jim owns; offer **Undo**; never use Spotify's automatic 5xx retry on an add (it could duplicate); remember that `DELETE` removes *every* copy of a track; and re-check fresh state from Spotify before acting, not cached state.
- **Every press must end visibly** ("Playing" observed, or a failure saying why). Nothing fails silently: that was the original problem (D3).
- **UI** follows direction B (D34): one primary action per area; destructive actions in red outline (`.danger-outline`, `.skip-remove`); secondary ones quiet (`.quiet`); rare actions in a **⋯** `Menu`; sidebars for sub-views (Library tags, Studio). Main targets are at least 44 px.
- **Security:** no secrets in the bundle (the Client ID is public); tokens only ever go to `api.spotify.com`; no `innerHTML`; any new outside host needs a CSP change in `public/_headers`. Accepted risks are recorded in D36.
- **Commits:** a short summary line, then what changed and why, ending with the Co-Authored-By line when Claude wrote it.
- **Dev environment:** the Nix flake (`flake.nix`, direnv), or any Node 20.19+. Python scripts run with `uv` (D17).

## Gotchas

- **Spotify development mode:** only accounts added under User Management in the developer dashboard can log in (up to 5). The owner lock narrows that to Jim.
- **Audio features** (tempo, energy, …) return 403 from Spotify for new apps, so they come from ReccoBeats, which covers about 64% of tracks (research.md §7.2).
- **Playlist items** can only be read for playlists you own or collaborate on (403 otherwise). Spotify's 2026 field is `item`; `track` is the deprecated twin.
- **The login callback** must run exactly once, before React renders (`main.tsx`); React's StrictMode runs effects twice.
- **The floating strip** (Document Picture-in-Picture) is a different realm: `instanceof HTMLElement` fails there, so `shortcuts.ts` checks tag names.
- **"This browser"** can only run in one tab at a time (`player/instance.ts`).
- **localStorage** is shared with the login (~5 MB): keep caches compact and capped. Token writes drop `cache.*` if storage is full.

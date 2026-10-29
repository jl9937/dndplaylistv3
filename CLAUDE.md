# D&D Playlist Manager

Jim's web app for switching Spotify playlists mid-session while running D&D, with an ambience mixer and a Studio for tidying playlists. Static React + TypeScript SPA, no backend, deployed to Cloudflare from `main`. v1.0 shipped 2026-10-29.

**Start with [docs/developing.md](docs/developing.md)**: the code map, how to check a change (including UI checks without a Spotify login), how it ships, conventions and gotchas. Decisions and their reasons are in [docs/spec.md §11](docs/spec.md) (D1–D36); open items are in the README's *Known limitations*.

## Commands

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run dev
```

The dev server is <http://127.0.0.1:5173/> (fixed port; never `localhost`).

## Working rules

- **Ask Jim before any push, tag or release.** Every push to `main` deploys to production. Commit locally freely.
- **Behaviour changes:** check spec §11 first. A new decision gets the next D-number, recorded with its reason.
- **New logic gets unit tests** (Vitest, dependencies injected). Check UI changes in the browser too: docs/developing.md shows how without a login.
- **Writes to Spotify** must be undoable, owner-only, and checked against fresh state. Spotify's `DELETE` removes every copy of a track.
- **Security matters to Jim:** no secrets in the bundle, tokens only to `api.spotify.com`, no `innerHTML`, and any new outside host needs a CSP change in `public/_headers`.
- **Dev environment:** the Nix flake (direnv) or Node 20.19+; Python via `uv`.
- **Writing:** plain, short sentences in docs and UI text; British spelling in prose.

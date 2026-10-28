# D&D Playlist Manager

A small web app for switching Spotify playlists quickly while running a D&D session. Before the game, pick a few playlists. During the game, switch between them with one click. Spotify does the playing; this app tells it what to play.

Status: **Milestone 1** built (log in, list playlists, click to play on the Spotify desktop app). Awaiting first real-Spotify test and soak test.

## Docs

- [docs/research.md](docs/research.md): Spotify platform constraints (2026), hosting, auth and framework research
- [docs/spec.md](docs/spec.md): product spec, architecture, milestones
- [docs/milestone-1.md](docs/milestone-1.md): Milestone 1, with acceptance criteria and technical design
- [docs/milestone-1b.md](docs/milestone-1b.md): Milestone 1b (in-browser player as automatic fallback)
- [docs/milestone-2a.md](docs/milestone-2a.md): Milestone 2a (Board, session sets, tags, quick switch)

## Stack

Static single-page app: Vite + React + TypeScript, plain CSS, Vitest. Spotify Authorization Code + PKCE in the browser (no backend, no client secret). Hosted free on Cloudflare (Workers static assets) at <https://dndplaylistv3.jim-lumsden.workers.dev/>.

## One-time setup

### 1. Spotify developer app
1. In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), create an app. Tick **Web API** (and **Web Playback SDK**, ready for Milestone 1b).
2. Add both redirect URIs, exactly:
   - `http://127.0.0.1:5173/` (local dev; Spotify rejects `localhost`)
   - the production URL, `https://dndplaylistv3.jim-lumsden.workers.dev/`
3. Under **User Management**, add the email of the Spotify account you log in with.
4. Copy the **Client ID**. It is public. Do not create or use a client secret.
5. Both the developer account and the listening account need full Spotify Premium.

### 2. Spotify desktop app and browser
- Spotify desktop app: **Settings → Autoplay → off**, so Spotify never adds its own tracks.
- Chrome or Edge: add the production URL under **Settings → Performance → Always keep these sites active**, so Memory Saver never discards the app window.

### 3. Cloudflare
The app deploys as a Worker with static assets only (no Worker script). [wrangler.jsonc](wrangler.jsonc) holds the config. In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, and pick this repo. Then, under the Worker's **Settings → Build**:
- Build command: `npm ci && npm test && npm run build`
- Deploy command: `npx wrangler deploy`
- Build variable: `VITE_SPOTIFY_CLIENT_ID` = your Client ID. It must be a build variable, not a runtime one, because Vite bakes it into the bundle.

Leave **Cloudflare Access** off for the `workers.dev` URL (**Settings → Domains & Routes**). It adds a second login that can expire mid-session.

Every push to `main` deploys to production. Branches and pull requests get preview URLs, which can't log in (they aren't registered redirect URIs). Security headers and the CSP come from [public/_headers](public/_headers) and apply in production only.

## Local development

The dev environment is a Nix flake. With [Nix](https://nixos.org/download) (flakes enabled) and direnv installed:

```bash
direnv allow
```

Or without direnv:

```bash
nix develop
```

Without Nix, any Node 20.19+ works. Then:

```bash
cp .env.example .env
```

Put your Client ID in `.env`, then:

```bash
npm install
```

```bash
npm run dev
```

Open <http://127.0.0.1:5173/>. The port is fixed (`strictPort`): if 5173 is busy, the server stops rather than moving, because a different port would break login.

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build`, and `npm run deploy` (manual deploy with Wrangler; normally Cloudflare deploys on push).

## Using it

1. Log in with Spotify.
2. Open the Spotify desktop app. Choose it under **Plays on** (on first run it is suggested if it's the only computer listed).
3. Before the session, press **Ready check**: it checks the login, the device, a test play (then pauses), shuffle and repeat.
4. Click a playlist. It starts at a random track, shuffled, repeating. The row shows **Playing** only once Spotify is seen playing it; otherwise **Failed** with the reason and what to do.

**Log** (or `?debug` in the URL) opens the event log, with **Copy log** and fault-injection buttons for testing token refresh. Its header shows the **build ID** (commit and build time). After a deploy, an open app window keeps running the old build until you reload it (Cmd+Shift+R), so check the build ID before reporting a bug.

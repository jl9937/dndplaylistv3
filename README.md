# D&D Playlist Manager

A small web app for switching Spotify playlists quickly while running a D&D session. Before the game, pick a few playlists. During the game, switch between them with one click. Spotify does the playing; this app tells it what to play.

Status: **v1.0** (2026-10-29). Milestones 1–5 are built and deployed; see [Known limitations](#known-limitations) for what isn't.

## Docs

- [docs/developing.md](docs/developing.md): **start here to work on the code**: code map, checking changes, shipping, conventions
- [docs/research.md](docs/research.md): Spotify platform constraints (2026), hosting, auth and framework research
- [docs/spec.md](docs/spec.md): product spec, architecture, milestones
- [docs/milestone-1.md](docs/milestone-1.md): Milestone 1, with acceptance criteria and technical design
- [docs/milestone-1b.md](docs/milestone-1b.md): Milestone 1b (in-browser player as automatic fallback)
- [docs/milestone-2a.md](docs/milestone-2a.md): Milestone 2a (Board, session sets, tags, quick switch)
- [docs/milestone-2b.md](docs/milestone-2b.md): Milestone 2b (compact strip, always-on-top floating strip)
- [docs/milestone-3.md](docs/milestone-3.md): Milestone 3 (soft transitions, tag pills, docked player)
- [docs/milestone-4.md](docs/milestone-4.md): Milestone 4 (ambience mixer, CC0 starter pack)
- [docs/milestone-5.md](docs/milestone-5.md): Milestone 5 (Studio: skip and remove, outliers, sort a holding playlist, tag a playlist)

## Stack

Static single-page app: Vite + React + TypeScript, plain CSS, Vitest. Spotify Authorization Code + PKCE in the browser (no backend, no client secret). Hosted free on Cloudflare (Workers static assets) at <https://dndplaylistv3.jim-lumsden.workers.dev/>.

## One-time setup

### 1. Spotify developer app
1. In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), create an app. Tick **Web API** and **Web Playback SDK** (the in-browser player).
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
- Build variable: `VITE_SPOTIFY_OWNER_ID` = your Spotify user ID (Spotify → Account → *Username*). The **owner lock**: any other Spotify account that logs in is logged straight out. Unset, the lock is off (the Log says so). A new value only applies from the next deploy.

**If a login is ever stolen:** Spotify has no way for the app to revoke its own tokens. Remove the app's access in your Spotify account (**Account → Apps → Remove access**), which ends every session at once.

Leave **Cloudflare Access** off for the `workers.dev` URL (**Settings → Domains & Routes**). It adds a second login that can expire mid-session.

Every push to `main` deploys to production. Branches and pull requests get preview URLs, which can't log in (they aren't registered redirect URIs). Security headers and the CSP come from [public/_headers](public/_headers) and apply in production only.

## Known limitations

As of v1.0:
- **Not built:** resume position (return to a playlist where it left off) and an offline shell (a service worker so the window opens instantly), both from Milestone 3.
- **Not yet done:** the Milestone 1 soak test (a long real-session run), a real-session check of the ambience mixer, and a tick-through of every milestone checklist. The app is in real use, but those checklists weren't ticked off item by item.
- **Audio features** come from ReccoBeats, which knows about two thirds of Jim's tracks and sees orchestral scores as much alike. Outliers are suggestions to listen to; holding-playlist suggestions are right about half the time in the top 3 (research.md §7.2).
- **One user:** the owner lock (D35) logs out any other Spotify account; there's no alert. Spotify's development mode also limits the app to accounts added in the developer dashboard.
- **Accepted security risks** (D36): Spotify's player script runs in the app's origin without a fixed fingerprint, and ReccoBeats sees which track IDs are in your playlists.
- **Browsers:** made for Chrome or Edge on a laptop (D8, D10). Float needs Chrome or Edge; Firefox and Safari are best effort; the app UI isn't designed for phones.
- **Board tiles** still show playlist covers; the Library uses tag-coloured squares (D34).

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

## Tags

Tags come from playlist names in Spotify. The app only renames a playlist when you add or remove a tag (**Library → ⋯ → Edit tags…**), and then only the `[Tag]` part.

| Name in Spotify | Tags | Shown as |
|---|---|---|
| `Town: Desert Town` | **Town** | Desert Town |
| `Battle: Blades in the Dark [Theme]` | **Battle**, **Theme** | Blades in the Dark |
| `Duskvol [Theme] [Heist]` | **Theme**, **Heist** | Duskvol |

- **`Tag:` at the start** sets the main group. Only the first colon counts, so `Setting: Hell: Lower Circle` keeps "Hell: Lower Circle".
- **`[Tag]` anywhere** adds an extra group, and is hidden from the displayed name.
- In the Library, a playlist appears under each of its tags. On the Board it goes in one section: its first tag.
- Tags ignore case. Playlists with no tag are hidden unless you click **Show N untagged**.

### config/tags.json
For anything the names can't express. `tagRules` add a tag to every playlist whose name matches; `hide` keeps matching playlists out of the Library and the palette:

```json
{
  "tagRules": [{ "tag": "Soundtrack", "contains": "OST", "removeFromName": false }],
  "hide": [{ "contains": "For DnD Sorting" }]
}
```

- Each rule matches with exactly one of `contains`, `startsWith` or `regex`, ignoring case. `removeFromName: true` drops the matched text from the displayed name.
- A broken rule is skipped and noted in the Log; `npm test` checks the file. Changes take effect once pushed, deployed and the app window reloaded.

## Using it

1. **Log in** with Spotify.
2. **Plays on** (the button at the right of the bottom bar; its dot is green when ready): choose the Spotify desktop app (suggested on first run if it's the only computer), a phone, or **This browser**. If the desktop app isn't open when you press a playlist, it plays in this window instead, with a notice.
3. **Library:** playlists in cards, grouped by tag, each with a square in its tag's colour. The **Tags** sidebar shows only some tags. **☆** puts a playlist on the Board; **⋯** has Play now, Edit tags and Open in Spotify.
4. **Board:** your playlists as tiles in sections by tag. Click a tile or press **1–9**. Drag tiles to reorder within a section; ↑/↓ moves a whole section.
5. **Any playlist:** press **Cmd+K** or **/**, type, then **Enter** to play or **Shift+Enter** to add it to the Board.
6. **Bottom bar:** what's playing, **Pause/Resume** and **Next**. With **✓ Fade** on, a switch fades the old music out over 3 s, then the new playlist starts at full volume.
7. **⋯ → Compact** (top right) turns the window into a narrow strip (the installed app docks itself to the screen edge). **⋯ → Float** opens the strip always-on-top, over Notion (Chrome or Edge).
8. **Ready check** before a session: login, device, a test play (then pause), shuffle and repeat.
9. **Ambience:** looping background sounds (rain, fire, crowd…) from this computer, on top of the music, each with its own volume. Turn layers on in the **Ambience** tab, then use a tile's **≈** button to save that mix on the tile. Pressing the tile then crossfades to its ambience as the playlist starts. Sounds are the files in [`ambience/`](ambience/README.md), added by committing them.
10. **Skip & remove** (bottom bar): a track that doesn't fit is skipped and removed from the playing playlist in Spotify, if the playlist is yours. **Undo** puts it back for 20 s. The first time, it asks you to log in again, to allow the app to change playlists.
11. **Studio → Sort a holding playlist:** after **Scan**, choose your holding playlist (e.g. *For dnd sorting*). Each track gets up to 3 suggested playlists with the reason (shared composer or album), and **Copy** to add it there (undoable), or **Copy to another playlist…**. The holding playlist isn't changed.
    **Studio → Outliers:** **Scan** your playlists for tracks that sound unlike the rest of their playlist, with the reason. **Play** to listen, then **Remove** (undoable) or **Keep** (it fits; not suggested again).
12. **Tag a playlist:** a Library card's **⋯ → Edit tags…** adds one of your tags (as `[Tag]` at the end of its name) or removes one, renaming it in Spotify. **Undo** renames it back.

Every press starts at a random track, shuffled, repeating the playlist. A tile shows **Playing** only once Spotify is seen playing it; otherwise **Failed** with the reason and what to do.

**⋯ → Log** (or `?debug` in the URL) opens the event log, with **Copy log** and fault-injection buttons for testing token refresh. Its header shows the **build ID** (commit and build time). After a deploy, an open app window keeps running the old build until you reload it (Cmd+Shift+R), so check the build ID before reporting a bug.

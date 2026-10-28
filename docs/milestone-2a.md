# Milestone 2a: Board, session sets, tags, quick switch

Status: building, 2026-10-28 · Parent: [spec.md](spec.md) · Builds on: [milestone-1.md](milestone-1.md) · Next: Milestone 2b (now-playing in the strip, compact mode, float spike)

## Goal

Before a session, I star the 5–9 playlists I'll need. During the session, the **Board** shows them as big tiles grouped by tag, and one click or one number key switches the music. Any other playlist is one `Cmd+K` away.

## Decisions (spec §11)
- **D18:** Milestone 2 is split. 2a is the Board workflow (this doc). 2b is the compact strip and the floating-window spike.
- **D19:** A session set holds **about 9** playlists. Keys `1`–`9` follow the Board's display order. More are allowed, with a note that only the first nine have keys.
- **D20:** The Board shows **sections by tag**. Sections appear in the order their first playlist was added, and can be moved up or down. Tiles are dragged to reorder within a section.
- **D21:** Now playing shows **track and artist**, with **Next** beside Pause/Resume. No volume slider, no cover art.
- **D22:** 2a comes before Milestone 1b and before the Milestone 1 soak test, at Jim's request. Milestone 1 works in real use.
- The known-tags allowlist (spec §13.1) is deferred to Milestone 3, with tag overrides.
- **D23 (after first use):** one Board, no named sets, no export/import. No Space shortcut. Untagged playlists hidden by default. A labelled **Add** / **On Board** button. The Library is a multi-column grid of cards. Song counts on rows. The criteria below are updated to match.

## Scope

**In:**
- tag parsing and the Library grouped by tag
- one Board, filled with **Add** from the Library and the palette
- the Board
- the quick-switch palette
- keyboard shortcuts
- now playing with Next
- hash routing
- a cached library for instant start-up

**Out (2b or later):**
- compact strip and floating window (2b)
- the allowlist and tag overrides (M3)
- the in-browser player (1b)
- ambience (M4)

## User stories and acceptance criteria

### US-2a-1: Tags from names
- [ ] `parsePlaylistName("Town: Desert Town")` → tag `Town`, short name `Desert Town`. It splits on the first colon only and trims both parts.
- [ ] No colon, or an empty side, gives **Untagged** and the full name.
- [ ] Tags group case-insensitively, displayed in their most common spelling.
- [ ] The Library shows sections by tag (A–Z, Untagged last), with short names sorted A–Z inside each. The filter matches the tag or the name.

### US-2a-2: The Board's playlists
- [ ] The Library is a grid of cards, in as many columns as fit (D23). Each card has a large, labelled **Add** / **On Board** toggle. The palette has a smaller one.
- [ ] Board items are stored as **scene** objects (`{id, playlistId, name}`), not bare IDs (D5).
- [ ] The Board survives reload and logout. It is saved in this browser's `localStorage` only. `navigator.storage.persist()` is requested on the first save.
- [ ] Library and palette rows show the song count (D23).
- [ ] Untagged playlists are hidden in the Library and palette, with a **Show N untagged** link (D23).

### US-2a-3: Board
- [ ] `#/board` shows the current set as large tiles in sections by tag (D20). Each tile shows the cover, short name, number key, and its play state (starting, playing, failed with reason and **Try again**).
- [ ] Click a tile to play it through the same pipeline as Milestone 1.
- [ ] Drag a tile within its section to reorder. Section headers have move up and move down.
- [ ] An empty Board points to **Add to Board** in the Library, with a link.
- [ ] A playlist on the Board that's no longer in the library shows as unavailable, with a remove button.

### US-2a-4: Quick switch
- [ ] `Cmd/Ctrl+K` or `/` opens a palette over the **whole** library from anywhere. It opens instantly, with no API call.
- [ ] Typing fuzzy-matches short names and tags. Results are grouped by tag, with the best matches first.
- [ ] `↑`/`↓` move, `Enter` plays, `Shift+Enter` (or the button) adds to or removes from the Board, `Esc` closes.
- [ ] A visible **All playlists** button opens it with the mouse.

### US-2a-5: Keyboard
- [ ] `1`–`9` play the matching Board tile, from any view.
- [ ] `Space` does nothing, and never re-presses a focused tile (D23). Pause/Resume is a button.
- [ ] Shortcuts are ignored while typing in a field, or when Cmd, Ctrl or Alt is held.

### US-2a-6: Now playing
- [ ] The player bar shows the current track and artist from `GET /me/player`. It polls every 5 s while the window is visible, and not while it's hidden.
- [ ] **Next** skips a track on the chosen device (`POST /me/player/next`).
- [ ] If Spotify is playing something this app didn't start, the bar says so (for example "Spotify is playing another playlist").

### US-2a-7: Routing and cache
- [ ] Tabs **Board** and **Library** switch between `#/board` and `#/library`. The default is the Board when it has items, otherwise the Library.
- [ ] The library is cached in `localStorage` with a timestamp. On load the cached list shows at once and is refreshed in the background. Logout clears the cache.

## Technical design
```
src/
  library/
    tags.ts          parsePlaylistName, groupByTag (pure, tested)
    search.ts        fuzzy scoring over short name + tag (pure, tested)
    libraryStore.ts  fetch, cache in localStorage (cache.library), subscribe
  board/             (renamed from sets/ after D23)
    board.ts         BoardDoc / Scene types, pure operations: toggle, remove,
                     move within section, move section, sections() (tested)
    boardStore.ts    persistence (sets.board), v1 migration, storage.persist()
    validate.ts      validates the stored Board, migrates v1 (tested)
  playback/
    nowPlaying.ts    visible-only polling of GET /me/player
  ui/
    router.ts        hash route hook
    Board.tsx  Library.tsx  Palette.tsx  shortcuts.ts
```
- The storage namespace `cache.*` is new. It's cleared on logout, like `auth.*`.
- The Board document is versioned. It was v1 (`{version: 1, currentId, sets: [...]}`, several sets) and is now v2 (`{version: 2, scenes}`, one Board, D23). v1 is migrated once on load.
- Number keys and Board order come from one function, `boardOrder(board)`, so they can't disagree.

## Definition of done
- [ ] Acceptance criteria pass by hand in Chrome or Edge, against real Spotify.
- [ ] Unit tests: tags, search, Board operations and order, stored-document validation.
- [ ] Deployed. The build ID shows in the Log.

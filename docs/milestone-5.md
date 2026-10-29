# Milestone 5: Playlist Studio

Status: building, 2026-10-29 · Parent: [spec.md](spec.md) §7, §13.4 · Research: [research.md §7.2](research.md#72-audio-features-for-the-playlist-studio)

## Goal
Keep the playlists in shape: drop a track that doesn't fit while it plays, find outliers, sort a holding playlist into themed ones, and tag playlists, without leaving the app.

## Decisions (spec §11)
- **D31:** four requests, in this order: skip and remove, outliers, sort a holding playlist (copy), tag a playlist. The app gets write access to Jim's playlists.
- **D32:** the spike's outcome. Audio features come from **ReccoBeats** (free, no key, 64% of Jim's tracks). Outliers are **suggestions to listen to**, never automatic. Recommendations rank playlists mainly by shared composer, album and existing playlists, with features as a tie-breaker.
- **D33:** write access (`playlist-modify-private`, `playlist-modify-public`) is asked for **at login**. One extra consent, once, and nothing interrupts a session. Tokens from before Milestone 5 lack it: the first write asks Jim to log in again and changes nothing.

## User stories and acceptance criteria

### US-5-1: Skip and remove (D31 #1)
- [ ] The docked player bar has **Skip & remove**. It skips to the next track at once, then removes the track from the playing playlist in Spotify (every copy of it).
- [ ] Only for playlists Jim owns. Otherwise, or when nothing or no playlist is playing, the button is disabled and its tooltip says why.
- [ ] A line above the bar says what was removed from where, with **Undo** for 20 s. Undo puts the track back at its old position. A failure says why, and a failed Undo offers **Try again**.
- [ ] Without write access, nothing is skipped or changed; the line asks Jim to log in again.
- [ ] The song count is refreshed afterwards, so the random start (D14) stays in range.

### US-5-2: Outliers (D31 #2)
- [ ] Per playlist, tracks much further from the playlist's centre than its other tracks, judged on energy, valence, danceability, acousticness, instrumentalness, tempo and loudness. Only playlists with at least 8 tracks that have features.
- [ ] Each suggestion shows why ("tempo 176, playlist 111"), with **Play** to listen and **Remove** (undoable).

### US-5-3: Sort a holding playlist (D31 #3)
- [ ] Pick an input playlist. For each track, the playlists it most likely belongs in, best first, with **Copy** to add it there. The input playlist is not changed.

### US-5-4: Tag a playlist (D31 #4)
- [ ] From the Library, add one of the existing tags to a playlist. The app renames it in Spotify by adding `[Tag]` (D25).

## Technical design
```
src/spotify/api.ts        getPlaylistTracks (with positions), removeFromPlaylist, addToPlaylist
src/playback/skipRemove.ts  what can be removed, remove (remembering the position), restore (tested)
src/ui/SkipRemove.tsx     the button's state and the Undo line
src/studio/               ReccoBeats client, coverage and outliers (spike, tested)
```
- **Removing** reads the playlist first to find the track's position (counting local files and episodes, as Spotify does), then sends `DELETE /playlists/{id}/items` with `{ items: [{ uri }] }`.
- **Undo** sends `POST /playlists/{id}/items` with `{ uris, position }`, with no automatic retry on a server error: if the first attempt landed, a retry would add the track twice.

## Definition of done
- [ ] Acceptance criteria pass by hand in Chrome, logged in with write access.
- [ ] Unit tests for each part.
- [ ] Deployed. The build ID shows in the Log.

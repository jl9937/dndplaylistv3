# Milestone 5: Playlist Studio

Status: shipped in **v1.0** (2026-10-29). Each part was checked against stubbed Spotify data; Jim has used skip and remove and the Studio's sorter and outliers for real · Parent: [spec.md](spec.md) §7, §13.4 · Research: [research.md §7.2](research.md#72-audio-features-for-the-playlist-studio)

## Goal
Keep the playlists in shape: drop a track that doesn't fit while it plays, find outliers, sort a holding playlist into themed ones, and tag playlists, without leaving the app.

## Decisions (spec §11)
- **D31:** four requests, in this order: skip and remove, outliers, sort a holding playlist (copy), tag a playlist. The app gets write access to Jim's playlists.
- **D32:** the spike's outcome. Audio features come from **ReccoBeats** (free, no key, 64% of Jim's tracks). Outliers are **suggestions to listen to**, never automatic. Recommendations rank playlists mainly by shared composer, album and existing playlists, with features as a tie-breaker.
- **D33:** write access (`playlist-modify-private`, `playlist-modify-public`) is asked for **at login**. One extra consent, once, and nothing interrupts a session. Tokens from before Milestone 5 lack it: the first write asks Jim to log in again and changes nothing.

## User stories and acceptance criteria

### US-5-1: Skip and remove (D31 #1)
- [x] The docked player bar has **Skip & remove**. It skips to the next track at once, then removes the track from the playing playlist in Spotify (every copy of it).
- [ ] Only for playlists Jim owns. Otherwise, or when nothing or no playlist is playing, the button is disabled and its tooltip says why.
- [ ] A line above the bar says what was removed from where, with **Undo** for 20 s. Undo puts the track back at its old position. A failure says why, and a failed Undo offers **Try again**.
- [ ] Without write access, nothing is skipped or changed; the line asks Jim to log in again.
- [ ] The song count is refreshed afterwards, so the random start (D14) stays in range.

### US-5-2: Outliers (D31 #2)
- [ ] A **Studio** tab (`#/studio`, replacing the spike page). **Scan** reads all my tagged playlists; the results last until the page is reloaded.
- [ ] Per playlist, tracks much further from the playlist's centre than its other tracks, judged on energy, valence, danceability, acousticness, instrumentalness, tempo and loudness. Only playlists with at least 8 tracks that have features. A tempo of 0 (no beat found) counts as unknown.
- [ ] Each suggestion shows why ("tempo 176 (playlist 111)"), with **Play** (the playlist from that track, on the chosen device), **Remove** (undoable) and **Keep** ("it fits": not suggested again, remembered in this browser; **Show kept** brings them back).
- [ ] Features are cached in this browser (`cache.features`), so a re-scan only asks ReccoBeats about new tracks. Tracks it didn't know are asked about again after a month.

### US-5-3: Sort a holding playlist (D31 #3)
- [ ] **Measure first:** after a scan, Studio's *How good would playlist suggestions be?* treats every track as new (all its memberships hidden) and reports how often one of its real playlists comes out first, or in the top 3 or 5, for each method: sound only, composer only, album only, and combinations, against a "biggest playlists" baseline. A hit needs evidence: a score of 0 never counts.
- [x] Measured on Jim's library (research.md §7.2): composer + album with sound breaking ties puts a real playlist in the top 3 for 49% of tracks (top 5: 57%), against 13% (19%) for the biggest playlists. Those are the sorter's weights.
- [ ] In Studio, after a scan: **Holding playlist** lists every playlist Jim owns, tagged or not (e.g. *For dnd sorting*), and remembers the choice.
- [ ] For each of its tracks: the top 3 scanned playlists it isn't already in, best first, with the reason ("3 tracks by Jesper Kyd, 2 from the same album") and **Copy** (adds it at the end, with **Undo**). "Already in …" shows where it's filed. **Copy to another playlist…** lists the rest. **Play** starts the holding playlist from that track.
- [ ] Choosing a playlist copies the track there (never as a duplicate: if it's already there, it says so) and, the first time, takes it out of the holding playlist (Jim, 2026-10-29). The row stays, so the track can go to a second playlist. **Undo** removes the copy only if it's there exactly once, and once no copy is left, puts the track back in the holding playlist at its old position.

### US-5-4: Tag a playlist (D31 #4)
- [ ] Each Library card for a playlist Jim owns has a **#** button. It opens a picker: **+ Tag** for every existing tag the playlist doesn't have, **× Tag** for each `[Tag]` already in its name.
- [ ] Choosing one renames the playlist in Spotify, adding or removing `[Tag]` at the end of the name (D25). The Library regroups at once, without waiting for a refresh.
- [ ] A line at the top says what it was renamed from and to, with **Undo** (renames it back) for 20 s. A failure says why, with **Try again**. Without write access it changes nothing and asks Jim to log in again.

### Later (Jim, 2026-10-29)
- [x] The player bar's art is the **playing track's** album art, or none at all, not the playlist's cover.

## Technical design
```
src/spotify/api.ts        getPlaylistTracks (with positions), removeFromPlaylist, addToPlaylist
src/playback/skipRemove.ts  what can be removed, remove (remembering the position), restore (tested)
src/ui/SkipRemove.tsx     the button's state and the Undo line
src/studio/               ReccoBeats client, feature cache, coverage and outliers, the scan (tested)
src/ui/Studio.tsx         the Studio tab: one Scan, then the sorter and outlier review
src/ui/Sorter.tsx         sort a holding playlist
src/studio/recommend.ts   buildIndex, suggest (composer, album, sound), evaluate (tested)
src/library/tags.ts       addTagToName, removeTagFromName, markerTags (tested)
src/ui/TagPicker.tsx      the picker under a Library card, and the rename line with Undo
```
- **Removing** reads the playlist first to find the track's position (counting local files and episodes, as Spotify does), then sends `DELETE /playlists/{id}/items` with `{ items: [{ uri }] }`.
- **Outliers:** distances in z-units over the whole scanned library. A track is an outlier when its distance from its playlist's centre (leaving itself out) is more than 3 robust spreads (MAD, at least 0.25) above the playlist's median distance.
- **Suggestions** score each playlist: tracks sharing a composer (artist ID) and tracks from the same album, each divided by the playlist's size + 4 (so tiny playlists don't win on one match), plus how close the track sounds to the playlist's centre (exp(−d²/8) in z-units). Weights are chosen from the measurement.
- **Play** starts the playlist at the track itself (`offset: { uri }`, `PlaylistRef.startTrack`), then shuffles on. Not by position: positions shift whenever a track is removed, which once made Play start the wrong track. If Spotify refuses that track, the press fails and says why, rather than playing another one.
- **Renaming** sends `PUT /playlists/{id}` with `{ name }`, then updates the cached library at once (`renameLocally`).
- **Undo** sends `POST /playlists/{id}/items` with `{ uris, position }`, with no automatic retry on a server error: if the first attempt landed, a retry would add the track twice.

## Definition of done
- [ ] Acceptance criteria pass by hand in Chrome, logged in with write access.
- [ ] Unit tests for each part.
- [ ] Deployed. The build ID shows in the Log.

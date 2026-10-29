# Milestone 4: Ambience mixer

Status: shipped in **v1.0** (2026-10-29). Not yet tried in a real session (mixer and tile presets with a login) · Parent: [spec.md](spec.md) §13.3 · Builds on: [milestone-3.md](milestone-3.md)

## Goal
Looping background sounds (rain, fire, tavern crowd…) play from this laptop, layered on top of the Spotify music. Each layer has its own volume. A Board tile can carry an ambience preset, so one press switches both the music and the ambience.

## Decisions (spec §11)
- **D28:** sounds are a **starter pack in the repo only**. There's no in-app upload and no IndexedDB. Jim adds the files himself, CC0 or other licences that allow committing them to a public repo, with credits in `ambience/CREDITS.md`.
- **D29:** pressing a tile that has a preset **crossfades** to it over 3 s. Layers the preset doesn't include fade out, and the preset's layers fade in to their saved volumes. A tile with no preset leaves the ambience as it is.
- **D30:** the mixer is a third tab, `#/ambience`. The docked player bar gets a compact ambience control (master volume and Stop). Each Board tile gets an **Ambience** button to save the current mix to it, or to clear it.

## User stories and acceptance criteria

### US-4-1: Sounds from a folder
- [ ] Any audio file in `ambience/` (`.ogg`, `.opus`, `.mp3`, `.m4a`, `.wav`, `.flac`, `.webm`) appears in the mixer after a build. Its name comes from the file name, so `Tavern crowd.ogg` shows as "Tavern crowd". No list to keep up to date.
- [ ] Sounds are sorted A–Z. An empty folder shows how to add sounds.

### US-4-2: Mixer
- [ ] Each sound has an on/off toggle and a volume slider. Turning a layer on or off fades over 1 s, with no clicks.
- [ ] Several layers loop at once, gaplessly (Web Audio buffers, not `<audio loop>`).
- [ ] A master ambience volume and **Stop all**. The ambience volume is independent of the Spotify volume and its fader.
- [ ] Volumes are remembered (`prefs.ambience`). After a reload nothing plays until a click, because of the browser's autoplay rules.
- [ ] A sound that fails to load or decode shows the reason, and the other layers keep playing.
- [ ] If the browser suspends audio (sleep, autoplay), a **Resume ambience** button appears.

### US-4-3: Presets on tiles
- [ ] A tile's **Ambience** button saves the current mix (the layers that are on, with their volumes) to that scene, or clears it. A tile with a preset shows its layer names.
- [ ] Pressing the tile (click, number key, strip, floating strip) starts the playlist through the play pipeline *and* crossfades the ambience (D29).
- [ ] The ambience works whichever device plays the music, including the phone.
- [ ] A preset sound that has since been removed from the folder is skipped.

## Technical design
```
ambience/            the sound files, served as hashed build assets; CREDITS.md
src/ambience/
  sounds.ts          discovery via import.meta.glob, file name -> {id, name, url} (tested)
  engine.ts          createAmbience(deps): AudioContext graph, desired-state reconcile,
                     buffer cache, fades, presets (tested with a fake AudioContext)
  instance.ts        the singleton for the main window, volumes saved in prefs.ambience
src/board/board.ts   Scene.ambience?: {soundId, volume}[]; setSceneAmbience (tested)
src/ui/Ambience.tsx  the mixer tab; AmbienceMini in the player dock
```
- Graph: `AudioBufferSourceNode(loop)`, then a per-layer `GainNode`, then the master `GainNode`, then the destination. Slider values from 0 to 1 map to gain v², which sounds more even.
- **Autoplay:** `unlock()` creates or resumes the `AudioContext` synchronously in the click handler. `playScene` calls it before anything else.
- **One AudioContext, in the main window.** Clicks in the floating strip call the same `playScene` (spike question: does a click there count as activation for the main window? If not, the Resume button covers it).
- **Memory:** a decoded 2-minute stereo loop is about 46 MB. Buffers are kept for the layers that are on, plus the 3 most recently used. Loops of 1–3 minutes are recommended.
- **CSP:** no change. Sounds are fetched from `'self'` (`connect-src`) and decoded by Web Audio, so `media-src` isn't needed.
- **Hosting limit:** Cloudflare Workers static assets allow at most 25 MiB per file.

## Definition of done
- [ ] Acceptance criteria pass by hand in Chrome, with real sound files.
- [ ] Unit tests: sound discovery, engine (on/off, volumes, presets, load errors, races), scene presets.
- [ ] Deployed. The build ID shows in the Log.

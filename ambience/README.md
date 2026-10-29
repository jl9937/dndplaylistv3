# Ambience sounds

Drop looping audio files here (`.ogg`, `.opus`, `.mp3`, `.m4a`, `.wav`, `.flac`, `.webm`). After the next build they appear in the app's **Ambience** tab, named after the file: `Tavern crowd.ogg` shows as "Tavern crowd".

- **Licence:** this repo is public, so only commit files whose licence allows that (CC0 is simplest). Record each file's source and licence in [CREDITS.md](CREDITS.md). Don't commit Tabletop Audio edits (CC BY-NC-ND) or anything "personal use only".
- **Processing:** put the Freesound download in `originals/` (git-ignored), add its ID and a name to `NAMES` in [`scripts/make_ambience_loops.py`](../scripts/make_ambience_loops.py), and run `uv run scripts/make_ambience_loops.py ambience` (needs ffmpeg). It matches loudness and makes the loop seamless.
- **Loops:** 1–3 minutes, cut so the end runs into the start without a click. Ogg Opus at 96–128 kbps keeps a 2-minute loop around 1.5–2 MB. Each file must be under 25 MiB (Cloudflare's limit).
- **Renaming a file** breaks any Board tile preset that uses it. Re-save the preset on the tile.

"""Turn downloaded Freesound files into matched, seamless Opus loops (ambience/, D28).

Per file: skip the first 2 s (handling noise), take up to 120 s, high-pass at 35 Hz, set
the gain so every loop is -23 LUFS, limit peaks to -1 dBFS, make the seam inaudible by
crossfading the 4 s after the loop's end into its start (equal power), and encode Ogg Opus.

Originals go in ambience/originals/ (git-ignored), named as Freesound downloads them
("<id>__<author>__<title>.<ext>"). Add the ID and the app name to NAMES. Needs ffmpeg with
libopus. Usage: uv run scripts/make_ambience_loops.py ambience
"""
import json, re, subprocess, sys
from pathlib import Path

SRC = Path(sys.argv[1])
ORIG = SRC / "originals"
TARGET_LUFS = -23.0
SKIP, XFADE, MAX_LEN = 2.0, 4.0, 120.0

# Freesound ID -> app name (the file name is the name shown in the mixer).
NAMES = {
    "194628": "Ghostly whispers",
    "200272": "Rain (countryside)",
    "212779": "Market",
    "459412": "River",
    "535069": "Ocean waves",
    "659964": "Cave drips",
    "682525": "Cave",
    "695295": "Tavern",
    "714808": "Monster lair",
    "717435": "Wind in trees",
    "717579": "Fireplace",
    "717843": "Rain (town)",
    "751680": "Windy day",
    "856018": "Forest",
}

def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)

def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=channels", "-of", "json", str(path)]).stdout
    d = json.loads(out)
    return float(d["format"]["duration"]), d["streams"][0]["channels"]

def loudness(path, start, length):
    err = run(["ffmpeg", "-nostats", "-ss", str(start), "-t", str(length), "-i", str(path),
               "-af", "highpass=f=35,ebur128", "-f", "null", "-"]).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])

report = []
for path in sorted(ORIG.iterdir()):
    fid = path.name.split("__")[0]
    if fid not in NAMES:
        continue
    dur, ch = probe(path)
    length = min(MAX_LEN, dur - SKIP - XFADE - 0.5)
    gain = TARGET_LUFS - loudness(path, SKIP, length + XFADE)
    out = SRC / f"{NAMES[fid]}.opus"
    # body = [SKIP+X, SKIP+L+X): crossfades at its end into head = [SKIP, SKIP+X).
    # The result ends where it starts, so loop=true has no seam.
    graph = (
        f"[0:a]aformat=channel_layouts={'stereo' if ch > 1 else 'mono'},highpass=f=35,volume={gain:.2f}dB,"
        # The limiter looks ahead, so it delays its output: run it before cutting, never after.
        f"alimiter=limit=0.891:attack=5:release=80:level=false,asplit[a][b];"
        f"[a]atrim={SKIP + XFADE}:{SKIP + length + XFADE},asetpts=N/SR/TB[body];"
        f"[b]atrim={SKIP}:{SKIP + XFADE},asetpts=N/SR/TB[head];"
        f"[body][head]acrossfade=d={XFADE}:c1=qsin:c2=qsin[out]"
    )
    run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-filter_complex", graph, "-map", "[out]",
         "-ar", "48000", "-c:a", "libopus", "-b:a", "96k" if ch > 1 else "64k", "-vbr", "on",
         "-map_metadata", "-1", str(out)])
    got_dur, _ = probe(out)
    report.append(f"{out.name:24} {got_dur:6.1f}s  gain {gain:+5.1f} dB  {out.stat().st_size / 1e6:4.1f} MB  <- {path.name}")

print("\n".join(report))

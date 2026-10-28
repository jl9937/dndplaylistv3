# Milestone 3: Quality of life

Status: started 2026-10-28 · Parent: [spec.md](spec.md) §7 · Builds on: [milestone-2b.md](milestone-2b.md)

## Done
- **Soft transitions (D26):** pressing a playlist while music plays fades it out, switches, then fades back in to the same volume.
  - It takes **3 s out and 4 s in** (lengthened after first use).
  - Remote devices (the desktop app) use 5 volume steps each way, because Spotify rate-limits volume commands and doesn't guarantee their order. That's about 11 volume commands per press, and the final volume is sent twice.
  - "This browser" fades locally and smoothly, in 12 steps.
  - The volume before the fade is remembered. A press during a fade fades in to that volume, not the quieter one. A failed press, Pause, Resume, Next or logout restores it at once.
  - There's no fade when nothing is playing, on devices that don't report volume, or when **Fade** is off. The toggle is in the bottom bar and saved in `prefs.fade`, on by default.
- **Tag filter pills (D27):** a row of toggle pills above the Library's tag sections. Select one or more to show only those tags; none selected shows all. Saved in `prefs.libraryTags`.
- **Other-tag labels:** in each Library tag group, a card shows its other tags as small labels before its name. So `Town: Asian [Asian]` and `Battle: Asian [Asian]` read as **Town** Asian and **Battle** Asian under Asian.
- **Now playing docked at the bottom (D27):** a fixed bar across the bottom of the main window, with the playlist's cover, a larger track line and larger buttons. The compact and floating strips keep their own bar at the top.

## Still to do (spec §7)
- Resume position: return to a playlist where it left off.
- Offline shell (a service worker), so the app window opens instantly.
- Tag overrides are covered by `[Tag]` markers and `config/tags.json` (D24, D25).

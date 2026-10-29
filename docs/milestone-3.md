# Milestone 3: Quality of life

Status: partly shipped in **v1.0** (2026-10-29): soft transitions and the docked player. Resume position and the offline shell weren't built · Parent: [spec.md](spec.md) §7 · Builds on: [milestone-2b.md](milestone-2b.md)

## Done
- **Soft transitions (D26):** pressing a playlist while music plays fades it out over **3 s**, then the new playlist starts at **full volume**. There's no fade in, at Jim's request after first use.
  - The volume comes back only once the new playlist is *seen* playing on the device. Spotify doesn't guarantee command order, so restoring it earlier could blast the old track for a moment. In practice that's a brief silence, then the new music.
  - Remote devices (the desktop app) fade in 5 volume steps, because Spotify rate-limits volume commands. "This browser" fades locally and smoothly, in 12 steps.
  - The volume before the fade is remembered. A press during a fade restores that volume, not the quieter one. A failed press, Pause, Resume, Next or logout restores it at once.
  - There's no fade when nothing is playing, on devices that don't report volume, or when **Fade** is off. The toggle is in the bottom bar and saved in `prefs.fade`, on by default.
- **Tag filter pills (D27):** a row of toggle pills above the Library's tag sections (since D34, a **Tags** sidebar). Select one or more to show only those tags; none selected shows all. Saved in `prefs.libraryTags`.
- **Other-tag labels:** in each Library tag group, a card shows its other tags as small labels before its name. So `Town: Asian [Asian]` and `Battle: Asian [Asian]` read as **Town** Asian and **Battle** Asian under Asian.
- **Now playing docked at the bottom (D27):** a fixed bar across the bottom of the main window, with cover art (since 2026-10-29, the track's album art), a larger track line and larger buttons. The compact and floating strips keep their own bar at the top.

## Not built (open after v1.0)
- Resume position: return to a playlist where it left off.
- Offline shell (a service worker), so the app window opens instantly.
- Tag overrides are covered by `[Tag]` markers and `config/tags.json` (D24, D25).

# Milestone 2b: Compact strip and floating window

Status: built 2026-10-28. Compact checked in the browser; Float can only be checked in real Chrome or Edge (the embedded test browser can't open Picture-in-Picture windows) · Parent: [spec.md](spec.md) §13.5, D12 · Builds on: [milestone-2a.md](milestone-2a.md)

## Goal
At the table, the app takes up a narrow strip beside Notion instead of a full window. Ideally that strip floats on top of everything, so I never have to dig for the app.

## User stories and acceptance criteria

### US-2b-1: Compact strip (A, the baseline)
- [ ] A **Compact** button switches to the strip: now playing with Pause/Resume and Next, then the Board's tiles stacked vertically (number key, cover, short name, status).
- [ ] In the installed app window, Compact also resizes the window to 360 px wide and full height, and moves it to the right edge of the screen. **Expand** restores the previous size and position.
- [ ] In a normal browser tab, Compact only changes the layout, because browsers don't let tabs resize themselves.
- [ ] Number keys work in the strip. A failed tile shows its reason and plays again on click.

### US-2b-2: Floating strip (B, the spike)
- [ ] When the browser supports Document Picture-in-Picture (Chrome or Edge), a **Float** button opens the same strip in an always-on-top window of 360 × 640.
- [ ] Tiles, Pause/Resume, Next and the number keys all work in the floating window.
- [ ] While it floats, now playing keeps updating even if the main window is minimised.
- [ ] **Back to app**, or closing the floating window, returns to the normal layout. The main window says the strip is floating, with a button to bring it back.

### Spike questions (spec §13.5), answered by using it
1. Does a click in the floating window count as a user gesture? This matters for 1b's `activateElement()`.
2. Do keyboard shortcuts work while it has focus?
3. With the main window minimised for a long time, do presses from the floating window still confirm quickly, or does Chrome throttle the main window's timers?
4. Closing the main window closes the floating one.
5. Does it survive sleep and wake?

## Technical design
- `src/ui/Strip.tsx` is one component used by both modes, from the same state.
- `src/ui/compact.ts` holds the dock and restore logic (installed window only) and `openFloat()`. That copies the app's stylesheets into the Picture-in-Picture document, which inherits the app's CSP.
- The strip is rendered into the floating window with a React portal.
- Shortcuts listen on both windows. Field detection uses tag names, because `instanceof` fails across windows.
- Now-playing polling counts the floating window as visible.

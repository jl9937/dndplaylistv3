// The main window's ambience mixer. Only one AudioContext, here: the floating strip calls
// into this one rather than making its own.

import { read, write } from '../storage';
import { createAmbience } from './engine';
import { sounds } from './sounds';

const PREF = 'prefs.ambience';
type Saved = { master: number; volumes: Record<string, number> };

export const ambience = createAmbience({
  sounds,
  createContext: () => new AudioContext({ latencyHint: 'playback' }),
  initial: read<Saved>(PREF) ?? undefined,
});

// Volumes survive a reload; what was playing doesn't (autoplay needs a click).
let saved = '';
ambience.subscribe(() => {
  const { master, layers } = ambience.getState();
  const next: Saved = { master, volumes: Object.fromEntries(Object.entries(layers).map(([id, l]) => [id, l.volume])) };
  const json = JSON.stringify(next);
  if (json !== saved) {
    saved = json;
    write(PREF, next);
  }
});

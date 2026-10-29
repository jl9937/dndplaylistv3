// A muted colour per tag, for the Library's coloured squares (UI direction B): fixed for the
// main tags, and a stable hue from the tag's name for the rest. All at similar lightness, so
// a grid of them stays calm. Colour never carries meaning alone: the name and tag stay.

import { tagKey } from './tags';

const FIXED: Record<string, string> = {
  town: '#b8794a',
  setting: '#5f8f6a',
  battle: '#a8524a',
  duskvol: '#7466a0',
  tavern: '#b89a48',
  theme: '#5e8597',
};

/** For untagged playlists. */
export const UNTAGGED_COLOUR = '#6b5f55';

export function tagColour(tag: string | null | undefined): string {
  const key = tagKey(tag ?? null);
  if (!key) return UNTAGGED_COLOUR;
  if (FIXED[key]) return FIXED[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `hsl(${h % 360} 28% 46%)`;
}

// Fuzzy search for the quick-switch palette (spec §13.2). Pure and synchronous: the
// palette must open and filter instantly with no API call.

import { describePlaylist } from './tags';

/**
 * Score one query token against text, or null if it doesn't match.
 * Substring beats subsequence; a match at a word start beats one mid-word.
 */
export function tokenScore(token: string, text: string): number | null {
  const t = text.toLocaleLowerCase();
  const idx = t.indexOf(token);
  if (idx >= 0) {
    const wordStart = idx === 0 || /[^\p{L}\p{N}]/u.test(t[idx - 1]);
    return 100 + (wordStart ? 50 : 0) - Math.min(idx, 40);
  }
  // Subsequence: every character in order, fewer gaps is better.
  let pos = -1;
  let gaps = 0;
  for (const ch of token) {
    const next = t.indexOf(ch, pos + 1);
    if (next < 0) return null;
    if (pos >= 0 && next > pos + 1) gaps++;
    pos = next;
  }
  return Math.max(1, 40 - gaps * 5);
}

/** Score a playlist name against the whole query. Every token must match the short name or a tag. */
export function nameScore(query: string, name: string, describe = describePlaylist): number | null {
  const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const { tags, shortName } = describe(name);
  let total = 0;
  for (const token of tokens) {
    const inName = tokenScore(token, shortName);
    const inTag = Math.max(-1, ...tags.map((t) => tokenScore(token, t) ?? -1));
    const best = Math.max(inName ?? -1, inTag < 0 ? -1 : inTag * 0.8);
    if (best < 0) return null;
    total += best;
  }
  return total;
}

/** Matching items, best first. An empty query returns everything in its original order. */
export function search<T>(items: T[], query: string, nameOf: (item: T) => string): T[] {
  if (!query.trim()) return items.slice();
  return items
    .map((item, i) => ({ item, i, score: nameScore(query, nameOf(item)) }))
    .filter((r): r is { item: T; i: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item);
}

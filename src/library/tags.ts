// Tags parsed from playlist names (spec §13.1, D6). Display only: nothing is renamed in Spotify.

export interface ParsedName {
  /** null means Untagged. */
  tag: string | null;
  shortName: string;
}

export const UNTAGGED_LABEL = 'Untagged';

/** `Town: Desert Town` → tag `Town`, short name `Desert Town`. Splits on the first colon only. */
export function parsePlaylistName(name: string): ParsedName {
  const i = name.indexOf(':');
  if (i < 0) return { tag: null, shortName: name.trim() };
  const tag = name.slice(0, i).trim();
  const shortName = name.slice(i + 1).trim();
  if (!tag || !shortName) return { tag: null, shortName: name.trim() };
  return { tag, shortName };
}

/** Grouping key: case-insensitive. '' is Untagged. */
export function tagKey(tag: string | null): string {
  return tag ? tag.toLocaleLowerCase() : '';
}

/** For each tag key, the most common spelling (ties: a capitalised one, then first seen). */
export function tagLabels(names: Iterable<string>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const name of names) {
    const { tag } = parsePlaylistName(name);
    if (!tag) continue;
    const spellings = counts.get(tagKey(tag)) ?? new Map<string, number>();
    spellings.set(tag, (spellings.get(tag) ?? 0) + 1);
    counts.set(tagKey(tag), spellings);
  }
  const labels = new Map<string, string>();
  for (const [key, spellings] of counts) {
    let best = '';
    let bestCount = 0;
    for (const [spelling, n] of spellings) {
      const capitalised = (x: string) => /^\p{Lu}/u.test(x);
      if (n > bestCount || (n === bestCount && capitalised(spelling) && !capitalised(best))) {
        [best, bestCount] = [spelling, n];
      }
    }
    labels.set(key, best);
  }
  return labels;
}

export function labelFor(key: string, labels: Map<string, string>): string {
  return key === '' ? UNTAGGED_LABEL : (labels.get(key) ?? key);
}

export interface TagGroup<T> {
  key: string;
  label: string;
  items: T[];
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Library grouping: tags A–Z with Untagged last; short names A–Z within each tag. */
export function groupByTag<T>(items: T[], nameOf: (item: T) => string): TagGroup<T>[] {
  const labels = tagLabels(items.map(nameOf));
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = tagKey(parsePlaylistName(nameOf(item)).tag);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: labelFor(key, labels),
      items: list.sort((a, b) =>
        collator.compare(parsePlaylistName(nameOf(a)).shortName, parsePlaylistName(nameOf(b)).shortName),
      ),
    }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : collator.compare(a.label, b.label)));
}

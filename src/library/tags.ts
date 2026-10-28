// Tags parsed from playlist names (spec §13.1, D6). Display only: nothing is renamed in Spotify.
// Extra tags and hide rules come from config/tags.json (D24).

import rawConfig from '../../config/tags.json';
import { log } from '../diagnostics/log';
import { parseTagConfig, type TagConfig } from './tagConfig';

export interface ParsedName {
  /** null means Untagged. */
  tag: string | null;
  shortName: string;
}

export const UNTAGGED_LABEL = 'Untagged';


export interface Described {
  /** Every tag, primary first: the `Tag:` prefix, then `[Tag]` markers, then config rules. */
  tags: string[];
  shortName: string;
  /** Matched a hide rule: left out of the Library and palette. */
  hidden: boolean;
}

const MARKER = /\[([^[\]]+)\]/g;

/** `Blades in the Dark [Theme] [Heist]` → tags Theme, Heist; rest "Blades in the Dark". */
export function extractMarkers(shortName: string): { tags: string[]; rest: string } {
  const tags = [...shortName.matchAll(MARKER)].map((m) => m[1].trim()).filter(Boolean);
  if (tags.length === 0) return { tags, rest: shortName };
  const rest = shortName.replace(MARKER, ' ').replace(/\s{2,}/g, ' ').trim();
  return { tags, rest: rest || shortName }; // a name that is only markers keeps its text
}

/** Build a describer for a config. The app uses `describePlaylist` (config/tags.json). */
export function createDescriber(config: TagConfig) {
  const cache = new Map<string, Described>();
  return (name: string): Described => {
    let d = cache.get(name);
    if (d) return d;
    const { tag, shortName: parsed } = parsePlaylistName(name);
    const tags: string[] = [];
    const add = (t: string) => {
      if (!tags.some((x) => tagKey(x) === tagKey(t))) tags.push(t);
    };
    if (tag) add(tag);
    // `[Theme]` anywhere in the name: an extra tag, hidden from the displayed name (D25).
    const { tags: marked, rest } = extractMarkers(parsed);
    marked.forEach(add);
    let shortName = rest;
    for (const rule of config.tagRules) {
      if (!rule.test(name)) continue;
      add(rule.tag);
      shortName = rule.strip(shortName);
    }
    d = { tags, shortName, hidden: config.hide.some((h) => h.test(name)) };
    cache.set(name, d);
    return d;
  };
}

const loaded = parseTagConfig(rawConfig);
for (const e of loaded.errors) log('app', `config/tags.json: ${e} (rule skipped)`);

export const describePlaylist = createDescriber(loaded.config);

/** Shown in the Library and palette: not hidden by a rule, and tagged unless untagged are shown. */
export function isListed(name: string, showUntagged: boolean, describe = describePlaylist): boolean {
  const d = describe(name);
  return !d.hidden && (showUntagged || d.tags.length > 0);
}

/** The section a playlist goes in on the Board: its first tag. */
export const primaryTagKey = (name: string, describe = describePlaylist) => tagKey(describe(name).tags[0] ?? null);

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
export function tagLabels(names: Iterable<string>, describe = describePlaylist): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const name of names) {
    for (const tag of describe(name).tags) {
      const spellings = counts.get(tagKey(tag)) ?? new Map<string, number>();
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1);
      counts.set(tagKey(tag), spellings);
    }
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

/**
 * Library grouping: tags A–Z with Untagged last; short names A–Z within each tag.
 * A playlist with several tags appears in each of their groups.
 */
export function groupByTag<T>(items: T[], nameOf: (item: T) => string, describe = describePlaylist): TagGroup<T>[] {
  const labels = tagLabels(items.map(nameOf), describe);
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const tags = describe(nameOf(item)).tags;
    for (const key of tags.length ? tags.map(tagKey) : ['']) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const short = (item: T) => describe(nameOf(item)).shortName;
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: labelFor(key, labels),
      items: list.sort((a, b) => collator.compare(short(a), short(b))),
    }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : collator.compare(a.label, b.label)));
}

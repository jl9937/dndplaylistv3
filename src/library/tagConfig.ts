// Tag rules from config/tags.json (D24): extra tags and hide rules on top of the
// "Tag: Name" convention. Bad rules are skipped and reported, never fatal.


export interface TagRule {
  tag: string;
  /** Remove the matched text from the displayed name ("Theme - Duskvol" → "Duskvol"). */
  removeFromName: boolean;
  test: (name: string) => boolean;
  strip: (shortName: string) => string;
}

export interface HideRule {
  test: (name: string) => boolean;
}

export interface TagConfig {
  tagRules: TagRule[];
  hide: HideRule[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toRegex(m: Record<string, unknown>): RegExp | string {
  const kinds = ['contains', 'startsWith', 'regex'].filter((k) => typeof m[k] === 'string' && m[k] !== '');
  if (kinds.length !== 1) return 'needs exactly one of "contains", "startsWith" or "regex"';
  const kind = kinds[0];
  const value = m[kind] as string;
  try {
    if (kind === 'contains') return new RegExp(escape(value), 'i');
    if (kind === 'startsWith') return new RegExp(`^\\s*${escape(value)}`, 'i');
    return new RegExp(value, 'i');
  } catch (e) {
    return `invalid regex (${e instanceof Error ? e.message : e})`;
  }
}

/** Separators left behind after removing a match, e.g. " - " or ": ". */
const tidy = (s: string) => s.replace(/^[\s\-–—:|·]+|[\s\-–—:|·]+$/g, '').replace(/\s{2,}/g, ' ');

export function parseTagConfig(raw: unknown): { config: TagConfig; errors: string[] } {
  const errors: string[] = [];
  const config: TagConfig = { tagRules: [], hide: [] };
  const obj = (raw ?? {}) as Record<string, unknown>;

  const tagRules = Array.isArray(obj.tagRules) ? obj.tagRules : [];
  tagRules.forEach((r: Record<string, unknown>, i) => {
    const where = `tagRules[${i}]`;
    if (typeof r?.tag !== 'string' || !r.tag.trim()) return errors.push(`${where}: "tag" must be a non-empty string`);
    const re = toRegex(r);
    if (typeof re === 'string') return errors.push(`${where}: ${re}`);
    const removeFromName = r.removeFromName === true;
    config.tagRules.push({
      tag: r.tag.trim(),
      removeFromName,
      test: (name) => re.test(name),
      strip: (short) => {
        if (!removeFromName || !re.test(short)) return short;
        const out = tidy(short.replace(re, ' '));
        return out || short; // never strip a name down to nothing
      },
    });
  });

  const hide = Array.isArray(obj.hide) ? obj.hide : [];
  hide.forEach((r: Record<string, unknown>, i) => {
    const re = toRegex(r ?? {});
    if (typeof re === 'string') return errors.push(`hide[${i}]: ${re}`);
    config.hide.push({ test: (name) => re.test(name) });
  });

  return { config, errors };
}

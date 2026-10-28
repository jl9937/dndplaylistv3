import { describe, expect, it } from 'vitest';
import shipped from '../config/tags.json';
import { parseTagConfig } from '../src/library/tagConfig';
import { createDescriber, groupByTag, primaryTagKey } from '../src/library/tags';

const describer = (raw: unknown) => createDescriber(parseTagConfig(raw).config);

describe('config/tags.json', () => {
  it('is valid', () => {
    expect(parseTagConfig(shipped).errors).toEqual([]);
  });
});

describe('tag rules', () => {
  const describe_ = describer({ tagRules: [{ tag: 'Theme', contains: 'Theme - ', removeFromName: true }] });

  it('adds a rule tag after the name tag, and strips the match from the name', () => {
    expect(describe_('Battle: Theme - Duskvol')).toEqual({ tags: ['Battle', 'Theme'], shortName: 'Duskvol', hidden: false });
  });

  it('tags otherwise-untagged playlists', () => {
    expect(describe_('Theme - Duskvol')).toEqual({ tags: ['Theme'], shortName: 'Duskvol', hidden: false });
  });

  it('ignores case, and leaves non-matching names alone', () => {
    expect(describe_('theme - Duskvol').tags).toEqual(['Theme']);
    expect(describe_('Town: Desert Town')).toEqual({ tags: ['Town'], shortName: 'Desert Town', hidden: false });
  });

  it('does not duplicate a tag the name already has', () => {
    expect(describe_('Theme: Theme - Duskvol').tags).toEqual(['Theme']);
  });

  it('never strips a name to nothing', () => {
    expect(describe_('Theme - ').shortName).toBe('Theme -');
  });

  it('keeps the name unchanged without removeFromName', () => {
    const d = describer({ tagRules: [{ tag: 'Boss', regex: '\\bboss\\b' }] });
    expect(d('Battle: Boss Fight')).toEqual({ tags: ['Battle', 'Boss'], shortName: 'Boss Fight', hidden: false });
  });

  it('supports startsWith', () => {
    const d = describer({ tagRules: [{ tag: 'Ambience', startsWith: 'amb ', removeFromName: true }] });
    expect(d('Amb Rain')).toEqual({ tags: ['Ambience'], shortName: 'Rain', hidden: false });
    expect(d('Light Amb Rain').tags).toEqual([]);
  });

  it('puts a multi-tag playlist in every Library group, but one Board section', () => {
    const groups = groupByTag(['Battle: Theme - Duskvol', 'Theme - Blades'], (n) => n, describe_);
    expect(groups.map((g) => [g.label, g.items])).toEqual([
      ['Battle', ['Battle: Theme - Duskvol']],
      ['Theme', ['Theme - Blades', 'Battle: Theme - Duskvol']],
    ]);
    expect(primaryTagKey('Battle: Theme - Duskvol', describe_)).toBe('battle');
  });
});

describe('hide rules', () => {
  it('marks matches hidden', () => {
    const d = describer({ hide: [{ contains: 'for dnd sorting' }] });
    expect(d('For DnD Sorting').hidden).toBe(true);
    expect(d('Town: Market').hidden).toBe(false);
  });
});

describe('bad rules', () => {
  it('are skipped with a readable error, never fatal', () => {
    const { config, errors } = parseTagConfig({
      tagRules: [{ tag: '', contains: 'x' }, { tag: 'A' }, { tag: 'B', contains: 'b', regex: 'b' }, { tag: 'C', regex: '(' }, { tag: 'OK', contains: 'ok' }],
      hide: [{}],
    });
    expect(config.tagRules.map((r) => r.tag)).toEqual(['OK']);
    expect(errors).toHaveLength(5);
    expect(errors[3]).toContain('invalid regex');
  });

  it('tolerates a missing or empty config', () => {
    expect(parseTagConfig(undefined)).toEqual({ config: { tagRules: [], hide: [] }, errors: [] });
  });
});

describe('[Tag] markers (D25)', () => {
  const d = describer({});

  it('adds each [Tag] as an extra tag after the prefix tag, and hides it from the name', () => {
    expect(d('Battle: Blades in the Dark [Theme]')).toEqual({ tags: ['Battle', 'Theme'], shortName: 'Blades in the Dark', hidden: false });
    expect(d('Battle: [Theme] Duel [Heist]')).toEqual({ tags: ['Battle', 'Theme', 'Heist'], shortName: 'Duel', hidden: false });
  });

  it('tags a name with no prefix', () => {
    expect(d('Duskvol [Theme]')).toEqual({ tags: ['Theme'], shortName: 'Duskvol', hidden: false });
  });

  it('ignores case when merging, and keeps a name that is only markers', () => {
    expect(d('Theme: Duskvol [theme]').tags).toEqual(['Theme']);
    expect(d('[Theme]').shortName).toBe('[Theme]');
  });

  it('ignores empty brackets', () => {
    expect(d('Town: Market []')).toEqual({ tags: ['Town'], shortName: 'Market []', hidden: false });
  });
});

import { describe, expect, it } from 'vitest';
import { groupByTag, parsePlaylistName, tagLabels } from '../src/library/tags';

describe('parsePlaylistName', () => {
  it.each([
    ['Town: Desert Town', 'Town', 'Desert Town'],
    ["Setting: Devil's Office", 'Setting', "Devil's Office"],
    ['  Xanathar :  Moonbase Corridors ', 'Xanathar', 'Moonbase Corridors'],
    ['Setting: Hell: Lower Circle', 'Setting', 'Hell: Lower Circle'],
  ])('%s', (name, tag, shortName) => {
    expect(parsePlaylistName(name)).toEqual({ tag, shortName });
  });

  it.each(['Best of Afro Celt Sound System', 'Setting:', ': Foo', 'Resource- Local Files', ':'])(
    'untagged: %s',
    (name) => {
      expect(parsePlaylistName(name)).toEqual({ tag: null, shortName: name.trim() });
    },
  );
});

describe('tagLabels', () => {
  it('uses the most common spelling per case-insensitive tag', () => {
    const labels = tagLabels(['town: A', 'Town: B', 'Town: C', 'Combat: D']);
    expect(labels.get('town')).toBe('Town');
    expect(labels.get('combat')).toBe('Combat');
  });
});

describe('groupByTag', () => {
  it('groups case-insensitively, tags A–Z, Untagged last, short names A–Z', () => {
    const names = ['Town: Zeta', 'Starred', 'combat: Boss', 'Town: alpha', 'town: Beta', 'Combat: Ambush'];
    const groups = groupByTag(names, (n) => n);
    expect(groups.map((g) => g.label)).toEqual(['Combat', 'Town', 'Untagged']);
    expect(groups[1].items).toEqual(['Town: alpha', 'town: Beta', 'Town: Zeta']);
    expect(groups[2].items).toEqual(['Starred']);
  });
});

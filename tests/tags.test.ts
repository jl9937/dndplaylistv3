import { describe, expect, it } from 'vitest';
import { addTagToName, groupByTag, markerTags, parsePlaylistName, removeTagFromName, tagLabels } from '../src/library/tags';

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

describe('adding and removing a tag in a name (D31 #4)', () => {
  it('adds a [Tag] marker at the end', () => {
    expect(addTagToName('Town: Desert Town', 'Desert')).toBe('Town: Desert Town [Desert]');
    expect(addTagToName('Wandering Bard ', 'Tavern')).toBe('Wandering Bard [Tavern]');
  });

  it('leaves a name alone if it already has the tag, in any case or form', () => {
    expect(addTagToName('Town: Desert Town', 'town')).toBe('Town: Desert Town');
    expect(addTagToName('Battle: Western [Badlands]', 'BADLANDS')).toBe('Battle: Western [Badlands]');
  });

  it('removes only that marker, tidying spaces', () => {
    expect(removeTagFromName('Battle: Blades [Theme] in the Dark [Heist]', 'theme')).toBe('Battle: Blades in the Dark [Heist]');
    expect(removeTagFromName('Town: Desert Town [Desert]', 'Desert')).toBe('Town: Desert Town');
    expect(removeTagFromName('Town: Desert Town', 'Town')).toBe('Town: Desert Town'); // a prefix isn't a marker
  });

  it('lists the markers, not the Tag: prefix', () => {
    expect(markerTags('Town: Asian [Asian] [Calm]')).toEqual(['Asian', 'Calm']);
  });
});

describe('tag colours', () => {
  it('are fixed for the main tags, any case, and stable for others', async () => {
    const { tagColour, UNTAGGED_COLOUR } = await import('../src/library/tagColour');
    expect(tagColour('Town')).toBe('#b8794a');
    expect(tagColour('setting')).toBe(tagColour('Setting'));
    expect(tagColour('Xanathar')).toBe(tagColour('xanathar'));
    expect(tagColour('Xanathar')).toMatch(/^hsl\(\d+ 28% 46%\)$/);
    expect(tagColour(null)).toBe(UNTAGGED_COLOUR);
  });
});

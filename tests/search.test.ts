import { describe, expect, it } from 'vitest';
import { nameScore, search, tokenScore } from '../src/library/search';

const names = [
  'Town: Desert Town',
  'Town: Grand Desert Palace',
  'Xanathar: Moonbase Corridors',
  'Xanathar: Sci Fi Club',
  'Combat: Boss Fight',
  'Best of Afro Celt Sound System',
];

describe('search', () => {
  it('returns everything in order for an empty query', () => {
    expect(search(names, '  ', (n) => n)).toEqual(names);
  });

  it('ranks a word-start match above a mid-word match', () => {
    expect(tokenScore('des', 'Desert Town')!).toBeGreaterThan(tokenScore('ser', 'Desert Town')!);
  });

  it('ranks substring above subsequence', () => {
    expect(tokenScore('moon', 'Moonbase')!).toBeGreaterThan(tokenScore('mnbs', 'Moonbase')!);
  });

  it('matches subsequences', () => {
    expect(search(names, 'mbc', (n) => n)).toContain('Xanathar: Moonbase Corridors');
  });

  it('matches tags', () => {
    expect(search(names, 'xanathar', (n) => n)).toEqual(['Xanathar: Moonbase Corridors', 'Xanathar: Sci Fi Club']);
  });

  it('requires every token to match', () => {
    expect(search(names, 'desert palace', (n) => n)).toEqual(['Town: Grand Desert Palace']);
    expect(nameScore('desert zebra', 'Town: Desert Town')).toBeNull();
  });

  it('puts the best match first', () => {
    expect(search(names, 'desert', (n) => n)[0]).toBe('Town: Desert Town');
    expect(search(names, 'boss', (n) => n)[0]).toBe('Combat: Boss Fight');
  });

  it('returns nothing for no match', () => {
    expect(search(names, 'qqq', (n) => n)).toEqual([]);
  });
});

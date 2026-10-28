import { describe, expect, it } from 'vitest';
import { exportDoc, parseDoc, parseImport } from '../src/sets/exportImport';
import {
  boardOrder,
  createSet,
  currentSet,
  deleteSet,
  emptyDoc,
  moveScene,
  moveSection,
  renameSet,
  sections,
  switchSet,
  syncNames,
  togglePlaylist,
  type SetsDoc,
} from '../src/sets/sets';

function withPlaylists(...names: string[]): SetsDoc {
  return names.reduce((doc, name, i) => togglePlaylist(doc, { id: `p${i}`, name }), emptyDoc());
}

const order = (doc: SetsDoc) => boardOrder(currentSet(doc)).map((s) => s.name);

describe('session sets', () => {
  it('starts with one empty set', () => {
    const doc = emptyDoc();
    expect(doc.sets).toHaveLength(1);
    expect(currentSet(doc).scenes).toEqual([]);
  });

  it('toggle adds a scene object, toggling again removes it', () => {
    let doc = togglePlaylist(emptyDoc(), { id: 'abc', name: 'Town: Market' });
    expect(currentSet(doc).scenes[0]).toMatchObject({ playlistId: 'abc', name: 'Town: Market' });
    expect(currentSet(doc).scenes[0].id).toBeTruthy();
    doc = togglePlaylist(doc, { id: 'abc', name: 'Town: Market' });
    expect(currentSet(doc).scenes).toEqual([]);
  });

  it('sections appear in order of first addition; new items join their section', () => {
    const doc = withPlaylists('Town: Market', 'Combat: Ambush', 'Town: Tavern', 'Starred');
    expect(sections(currentSet(doc)).map((s) => s.label)).toEqual(['Town', 'Combat', 'Untagged']);
    expect(order(doc)).toEqual(['Town: Market', 'Town: Tavern', 'Combat: Ambush', 'Starred']);
    // stored order matches board order (the invariant)
    expect(currentSet(doc).scenes.map((s) => s.name)).toEqual(order(doc));
  });

  it('moves a scene within its section only', () => {
    let doc = withPlaylists('Town: A', 'Town: B', 'Town: C', 'Combat: X');
    const [a, , c, x] = boardOrder(currentSet(doc));
    doc = moveScene(doc, c.id, a.id);
    expect(order(doc)).toEqual(['Town: C', 'Town: A', 'Town: B', 'Combat: X']);
    expect(order(moveScene(doc, x.id, a.id))).toEqual(order(doc)); // across sections: ignored
  });

  it('moves sections up and down, keeping tiles together', () => {
    let doc = withPlaylists('Town: A', 'Combat: X', 'Town: B', 'Rest: R');
    doc = moveSection(doc, 'combat', -1);
    expect(order(doc)).toEqual(['Combat: X', 'Town: A', 'Town: B', 'Rest: R']);
    doc = moveSection(doc, 'combat', -1); // already first: no change
    expect(order(doc)[0]).toBe('Combat: X');
    doc = moveSection(doc, 'town', 1);
    expect(order(doc)).toEqual(['Combat: X', 'Rest: R', 'Town: A', 'Town: B']);
  });

  it('syncNames picks up renames and retags, and keeps the doc identity when nothing changed', () => {
    const doc = withPlaylists('Town: A', 'Combat: X');
    expect(syncNames(doc, new Map([['p0', 'Town: A']]))).toBe(doc);
    const renamed = syncNames(doc, new Map([['p0', 'Combat: A']]));
    expect(sections(currentSet(renamed)).map((s) => s.label)).toEqual(['Combat']);
  });

  it('creates, renames, switches and deletes sets, always keeping one', () => {
    let doc = createSet(emptyDoc(), 'Xanathar 12');
    expect(doc.sets).toHaveLength(2);
    expect(currentSet(doc).name).toBe('Xanathar 12');
    doc = renameSet(doc, doc.currentId, '  Xanathar 13 ');
    expect(currentSet(doc).name).toBe('Xanathar 13');
    expect(renameSet(doc, doc.currentId, '   ')).toBe(doc);
    const firstId = doc.sets[0].id;
    doc = switchSet(doc, firstId);
    expect(doc.currentId).toBe(firstId);
    doc = deleteSet(doc, firstId);
    expect(doc.sets).toHaveLength(1);
    expect(currentSet(doc).name).toBe('Xanathar 13');
    doc = deleteSet(doc, doc.currentId);
    expect(doc.sets).toHaveLength(1);
  });
});

describe('export and import', () => {
  it('round-trips', () => {
    const doc = withPlaylists('Town: A', 'Combat: X');
    const result = parseImport(exportDoc(doc));
    expect(result).toEqual({ ok: true, doc });
  });

  it('rejects files that are not ours, bad JSON, and malformed scenes', () => {
    expect(parseImport('nope')).toMatchObject({ ok: false, error: 'The file is not valid JSON.' });
    expect(parseImport('{"version":1,"sets":[]}')).toMatchObject({ ok: false });
    const bad = JSON.parse(exportDoc(withPlaylists('Town: A')));
    bad.sets[0].scenes[0].playlistId = '../../etc';
    expect(parseImport(JSON.stringify(bad))).toMatchObject({ ok: false });
  });

  it('drops unknown fields and fixes a dangling currentId', () => {
    const result = parseDoc({
      version: 1,
      currentId: 'missing',
      extra: true,
      sets: [{ id: 's1', name: 'One', evil: '<script>', scenes: [{ id: 'c1', playlistId: 'abc', name: 'Town: A', x: 1 }] }],
    });
    expect(result).toEqual({
      ok: true,
      doc: { version: 1, currentId: 's1', sets: [{ id: 's1', name: 'One', scenes: [{ id: 'c1', playlistId: 'abc', name: 'Town: A' }] }] },
    });
  });
});

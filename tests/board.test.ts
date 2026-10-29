import { describe, expect, it } from 'vitest';
import {
  boardOrder,
  emptyBoard,
  isOnBoard,
  moveScene,
  moveSection,
  removeScene,
  sections,
  setSceneAmbience,
  syncNames,
  toggleOnBoard,
  type BoardDoc,
} from '../src/board/board';
import { getBoard, reloadBoardForTests, updateBoard } from '../src/board/boardStore';
import { migrateV1, parseBoard } from '../src/board/validate';
import { read, write } from '../src/storage';

function withPlaylists(...names: string[]): BoardDoc {
  return names.reduce((b, name, i) => toggleOnBoard(b, { id: `p${i}`, name }), emptyBoard());
}

const order = (b: BoardDoc) => boardOrder(b).map((s) => s.name);

describe('the Board', () => {
  it('starts empty', () => {
    expect(emptyBoard()).toEqual({ version: 2, scenes: [] });
  });

  it('toggle adds a scene object, toggling again removes it', () => {
    let b = toggleOnBoard(emptyBoard(), { id: 'abc', name: 'Town: Market' });
    expect(b.scenes[0]).toMatchObject({ playlistId: 'abc', name: 'Town: Market' });
    expect(b.scenes[0].id).toBeTruthy();
    expect(isOnBoard(b, 'abc')).toBe(true);
    b = toggleOnBoard(b, { id: 'abc', name: 'Town: Market' });
    expect(b.scenes).toEqual([]);
  });

  it('sections appear in order of first addition; new items join their section', () => {
    const b = withPlaylists('Town: Market', 'Combat: Ambush', 'Town: Tavern', 'Starred');
    expect(sections(b).map((s) => s.label)).toEqual(['Town', 'Combat', 'Untagged']);
    expect(order(b)).toEqual(['Town: Market', 'Town: Tavern', 'Combat: Ambush', 'Starred']);
    expect(b.scenes.map((s) => s.name)).toEqual(order(b)); // the invariant: stored order is Board order
  });

  it('moves a scene within its section only', () => {
    let b = withPlaylists('Town: A', 'Town: B', 'Town: C', 'Combat: X');
    const [a, , c, x] = boardOrder(b);
    b = moveScene(b, c.id, a.id);
    expect(order(b)).toEqual(['Town: C', 'Town: A', 'Town: B', 'Combat: X']);
    expect(moveScene(b, x.id, a.id)).toBe(b); // across sections: ignored
  });

  it('moves sections up and down, keeping tiles together', () => {
    let b = withPlaylists('Town: A', 'Combat: X', 'Town: B', 'Rest: R');
    b = moveSection(b, 'combat', -1);
    expect(order(b)).toEqual(['Combat: X', 'Town: A', 'Town: B', 'Rest: R']);
    expect(moveSection(b, 'combat', -1)).toBe(b); // already first
    b = moveSection(b, 'town', 1);
    expect(order(b)).toEqual(['Combat: X', 'Rest: R', 'Town: A', 'Town: B']);
  });

  it('removes a scene by id', () => {
    const b = withPlaylists('Town: A', 'Town: B');
    expect(order(removeScene(b, b.scenes[0].id))).toEqual(['Town: B']);
  });

  it('saves an ambience preset on one scene, and an empty preset clears it', () => {
    const b = withPlaylists('Town: A', 'Town: B');
    const id = b.scenes[0].id;
    const withRain = setSceneAmbience(b, id, [{ soundId: 'Rain.ogg', volume: 0.7 }]);
    expect(withRain.scenes[0].ambience).toEqual([{ soundId: 'Rain.ogg', volume: 0.7 }]);
    expect(withRain.scenes[1].ambience).toBeUndefined();
    expect('ambience' in setSceneAmbience(withRain, id, []).scenes[0]).toBe(false);
  });

  it('syncNames picks up renames and retags, and keeps the doc identity when nothing changed', () => {
    const b = withPlaylists('Town: A', 'Combat: X');
    expect(syncNames(b, new Map([['p0', 'Town: A']]))).toBe(b);
    expect(sections(syncNames(b, new Map([['p0', 'Combat: A']]))).map((s) => s.label)).toEqual(['Combat']);
  });
});

describe('stored Board validation', () => {
  it('round-trips, keeping extra scene fields a later feature adds', () => {
    const b: BoardDoc = { version: 2, scenes: [{ id: 'c1', playlistId: 'abc', name: 'Town: A', lighting: 'dim' } as never] };
    expect(parseBoard(JSON.parse(JSON.stringify(b)))).toEqual({ ok: true, board: b });
  });

  it('keeps well-formed ambience layers and drops the rest, without rejecting the scene', () => {
    const scene = (ambience: unknown) => ({ version: 2, scenes: [{ id: 'c1', playlistId: 'abc', name: 'A', ambience }] });
    const ok = parseBoard(scene([{ soundId: 'Rain.ogg', volume: 0.5, x: 1 }, { soundId: '', volume: 1 }, { soundId: 'Fire.ogg', volume: 3 }]));
    expect(ok).toEqual({ ok: true, board: { version: 2, scenes: [{ id: 'c1', playlistId: 'abc', name: 'A', ambience: [{ soundId: 'Rain.ogg', volume: 0.5 }] }] } });
    expect(parseBoard(scene('rain'))).toEqual({ ok: true, board: { version: 2, scenes: [{ id: 'c1', playlistId: 'abc', name: 'A' }] } });
  });

  it('rejects malformed documents and scenes', () => {
    expect(parseBoard(null)).toMatchObject({ ok: false });
    expect(parseBoard({ version: 3, scenes: [] })).toMatchObject({ ok: false });
    expect(parseBoard({ version: 2, scenes: [{ id: 'c', playlistId: '../../etc', name: 'x' }] })).toMatchObject({ ok: false });
  });

  it('migrates v1 session sets: the current set becomes the Board', () => {
    const v1 = {
      version: 1,
      currentId: 's2',
      sets: [
        { id: 's1', name: 'Old', scenes: [{ id: 'a', playlistId: 'p1', name: 'Town: A' }] },
        { id: 's2', name: 'Current', scenes: [{ id: 'b', playlistId: 'p2', name: 'Combat: B' }] },
      ],
    };
    expect(migrateV1(v1)).toEqual({ ok: true, board: { version: 2, scenes: [{ id: 'b', playlistId: 'p2', name: 'Combat: B' }] } });
  });
});

describe('Board storage', () => {
  it('migrates a v1 document once, then reads v2', () => {
    write('sets.v1', { version: 1, currentId: 's1', sets: [{ id: 's1', name: 'Session 1', scenes: [{ id: 'a', playlistId: 'p1', name: 'Town: A' }] }] });
    reloadBoardForTests();
    expect(getBoard().scenes.map((s) => s.playlistId)).toEqual(['p1']);
    expect(read('sets.v1')).toBeNull();
    expect(read('sets.board')).toMatchObject({ version: 2 });
  });

  it('saves updates', () => {
    reloadBoardForTests();
    updateBoard((b) => toggleOnBoard(b, { id: 'p9', name: 'Rest: Camp' }));
    expect(read<BoardDoc>('sets.board')!.scenes.map((s) => s.playlistId)).toContain('p9');
  });

  it('starts empty on an unreadable value instead of breaking', () => {
    write('sets.board', { version: 2, scenes: 'nope' });
    reloadBoardForTests();
    expect(getBoard()).toEqual(emptyBoard());
  });
});

// Session sets and scenes (spec §5, D5, D19, D20). Pure functions over an immutable document.
//
// Invariant: a set's `scenes` array is always contiguous by section (tag), in Board order.
// So the Board, the number keys and storage can never disagree about order.

import { labelFor, parsePlaylistName, tagKey, tagLabels } from '../library/tags';

/** A Board item. A scene (not a bare playlist ID) so Milestone 4 can attach ambience to it. */
export interface Scene {
  id: string;
  playlistId: string;
  /** Spotify name, cached so the set reads sensibly offline, in exports, and if the playlist is gone. */
  name: string;
}

export interface SessionSet {
  id: string;
  name: string;
  scenes: Scene[];
}

export interface SetsDoc {
  version: 1;
  currentId: string;
  sets: SessionSet[];
}

export interface Section {
  key: string;
  label: string;
  scenes: Scene[];
}

export const KEYED_TILES = 9;

const newId = () => crypto.randomUUID();

/** One Board (D23). The doc shape allows more sets, but the app only ever uses one. */
export function emptyDoc(): SetsDoc {
  const first: SessionSet = { id: newId(), name: 'Board', scenes: [] };
  return { version: 1, currentId: first.id, sets: [first] };
}

export function currentSet(doc: SetsDoc): SessionSet {
  return doc.sets.find((s) => s.id === doc.currentId) ?? doc.sets[0];
}

const sceneKey = (s: Scene) => tagKey(parsePlaylistName(s.name).tag);

/** Sections in order of first appearance. */
export function sections(set: SessionSet): Section[] {
  const labels = tagLabels(set.scenes.map((s) => s.name));
  const out: Section[] = [];
  for (const scene of set.scenes) {
    const key = sceneKey(scene);
    let section = out.find((x) => x.key === key);
    if (!section) {
      section = { key, label: labelFor(key, labels), scenes: [] };
      out.push(section);
    }
    section.scenes.push(scene);
  }
  return out;
}

/** The Board's display order. Number keys 1–9 index into this. */
export function boardOrder(set: SessionSet): Scene[] {
  return sections(set).flatMap((s) => s.scenes);
}

function updateCurrent(doc: SetsDoc, fn: (set: SessionSet) => SessionSet): SetsDoc {
  const cur = currentSet(doc);
  return { ...doc, sets: doc.sets.map((s) => (s.id === cur.id ? normalise(fn(s)) : s)) };
}

function normalise(set: SessionSet): SessionSet {
  return { ...set, scenes: boardOrder(set) };
}

export function hasPlaylist(set: SessionSet, playlistId: string): boolean {
  return set.scenes.some((s) => s.playlistId === playlistId);
}

/** Add to the end of its section (a new section goes last), or remove if already present. */
export function togglePlaylist(doc: SetsDoc, playlist: { id: string; name: string }): SetsDoc {
  return updateCurrent(doc, (set) =>
    hasPlaylist(set, playlist.id)
      ? { ...set, scenes: set.scenes.filter((s) => s.playlistId !== playlist.id) }
      : { ...set, scenes: [...set.scenes, { id: newId(), playlistId: playlist.id, name: playlist.name }] },
  );
}

export function removeScene(doc: SetsDoc, sceneId: string): SetsDoc {
  return updateCurrent(doc, (set) => ({ ...set, scenes: set.scenes.filter((s) => s.id !== sceneId) }));
}

/** Move a scene to `targetSceneId`'s position. Only within the same section. */
export function moveScene(doc: SetsDoc, sceneId: string, targetSceneId: string): SetsDoc {
  return updateCurrent(doc, (set) => {
    const from = set.scenes.findIndex((s) => s.id === sceneId);
    const to = set.scenes.findIndex((s) => s.id === targetSceneId);
    if (from < 0 || to < 0 || from === to) return set;
    if (sceneKey(set.scenes[from]) !== sceneKey(set.scenes[to])) return set;
    const scenes = set.scenes.slice();
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved);
    return { ...set, scenes };
  });
}

/** Swap a section with its neighbour: -1 is up, +1 is down. */
export function moveSection(doc: SetsDoc, key: string, dir: -1 | 1): SetsDoc {
  return updateCurrent(doc, (set) => {
    const list = sections(set);
    const i = list.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return set;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...set, scenes: list.flatMap((s) => s.scenes) };
  });
}

/** Refresh cached names from the library (renames, retags). Returns the same doc if nothing changed. */
export function syncNames(doc: SetsDoc, names: Map<string, string>): SetsDoc {
  let changed = false;
  const sets = doc.sets.map((set) => {
    let setChanged = false;
    const scenes = set.scenes.map((s) => {
      const name = names.get(s.playlistId);
      if (name === undefined || name === s.name) return s;
      setChanged = true;
      return { ...s, name };
    });
    if (!setChanged) return set;
    changed = true;
    return normalise({ ...set, scenes });
  });
  return changed ? { ...doc, sets } : doc;
}

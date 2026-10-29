// The Board (D19–D23): one ordered list of scenes, shown in sections by tag. Pure functions
// over an immutable document.
//
// Invariant: `scenes` is always contiguous by section (first tag), in Board order. So the
// Board, the number keys and storage can never disagree about order.

import type { PresetLayer } from '../ambience/engine';
import { labelFor, primaryTagKey, tagLabels } from '../library/tags';

/**
 * A Board tile: a playlist, plus an optional ambience preset (Milestone 4).
 * Unknown fields survive load and save (see validate.ts), so new features can add their own.
 */
export interface Scene {
  id: string;
  playlistId: string;
  /** Spotify name, cached so the tile reads sensibly if the playlist leaves the library. */
  name: string;
  /** Pressing the tile crossfades the ambience to these layers (D29). */
  ambience?: PresetLayer[];
}

export interface BoardDoc {
  version: 2;
  scenes: Scene[];
}

export interface Section {
  key: string;
  label: string;
  scenes: Scene[];
}

export const KEYED_TILES = 9;

export function emptyBoard(): BoardDoc {
  return { version: 2, scenes: [] };
}

/** A tile goes in one section: its first tag (D24). */
const sceneKey = (s: Scene) => primaryTagKey(s.name);

/** Sections in order of first appearance. */
export function sections(board: BoardDoc): Section[] {
  const labels = tagLabels(board.scenes.map((s) => s.name));
  const out: Section[] = [];
  for (const scene of board.scenes) {
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
export function boardOrder(board: BoardDoc): Scene[] {
  return sections(board).flatMap((s) => s.scenes);
}

const withScenes = (board: BoardDoc, scenes: Scene[]): BoardDoc => {
  const next = { ...board, scenes };
  return { ...next, scenes: boardOrder(next) };
};

export function isOnBoard(board: BoardDoc, playlistId: string): boolean {
  return board.scenes.some((s) => s.playlistId === playlistId);
}

/** Add to the end of its section (a new section goes last), or remove if already there. */
export function toggleOnBoard(board: BoardDoc, playlist: { id: string; name: string }): BoardDoc {
  return isOnBoard(board, playlist.id)
    ? withScenes(board, board.scenes.filter((s) => s.playlistId !== playlist.id))
    : withScenes(board, [...board.scenes, { id: crypto.randomUUID(), playlistId: playlist.id, name: playlist.name }]);
}

export function removeScene(board: BoardDoc, sceneId: string): BoardDoc {
  return withScenes(board, board.scenes.filter((s) => s.id !== sceneId));
}

/** Save an ambience preset on a scene; an empty preset removes it. */
export function setSceneAmbience(board: BoardDoc, sceneId: string, preset: PresetLayer[]): BoardDoc {
  return {
    ...board,
    scenes: board.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      const { ambience: _old, ...rest } = s;
      return preset.length > 0 ? { ...rest, ambience: preset } : rest;
    }),
  };
}

/** Move a scene to `targetSceneId`'s position. Only within the same section. */
export function moveScene(board: BoardDoc, sceneId: string, targetSceneId: string): BoardDoc {
  const from = board.scenes.findIndex((s) => s.id === sceneId);
  const to = board.scenes.findIndex((s) => s.id === targetSceneId);
  if (from < 0 || to < 0 || from === to) return board;
  if (sceneKey(board.scenes[from]) !== sceneKey(board.scenes[to])) return board;
  const scenes = board.scenes.slice();
  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  return withScenes(board, scenes);
}

/** Swap a section with its neighbour: -1 is up, +1 is down. */
export function moveSection(board: BoardDoc, key: string, dir: -1 | 1): BoardDoc {
  const list = sections(board);
  const i = list.findIndex((s) => s.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return board;
  [list[i], list[j]] = [list[j], list[i]];
  return withScenes(board, list.flatMap((s) => s.scenes));
}

/** Refresh cached names from the library (renames, retags). Returns the same doc if nothing changed. */
export function syncNames(board: BoardDoc, names: Map<string, string>): BoardDoc {
  let changed = false;
  const scenes = board.scenes.map((s) => {
    const name = names.get(s.playlistId);
    if (name === undefined || name === s.name) return s;
    changed = true;
    return { ...s, name };
  });
  return changed ? withScenes(board, scenes) : board;
}

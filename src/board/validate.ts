// Validates the Board loaded from localStorage, so a corrupt or hand-edited value can't
// break the app. Also migrates the v1 format (several named "session sets", D23).

import type { PresetLayer } from '../ambience/engine';
import type { BoardDoc, Scene } from './board';

export type ParseResult = { ok: true; board: BoardDoc } | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const PLAYLIST_ID = /^[A-Za-z0-9]{1,64}$/;

/** A scene's ambience preset, keeping only well-formed layers. Absent if none survive. */
function parsePreset(raw: unknown): PresetLayer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const layers = raw.filter(
    (l): l is PresetLayer => isString(l?.soundId) && typeof l.volume === 'number' && l.volume >= 0 && l.volume <= 1,
  );
  return layers.length > 0 ? layers.map(({ soundId, volume }) => ({ soundId, volume })) : undefined;
}

/** A valid scene, keeping any extra fields a later feature stored on it. */
function parseScene(raw: unknown): Scene | null {
  const sc = raw as Record<string, unknown> | null;
  if (!sc || !isString(sc.id) || !isString(sc.playlistId) || !PLAYLIST_ID.test(sc.playlistId) || typeof sc.name !== 'string') {
    return null;
  }
  const { ambience: rawPreset, ...rest } = sc;
  const ambience = parsePreset(rawPreset);
  return { ...rest, id: sc.id, playlistId: sc.playlistId, name: sc.name, ...(ambience && { ambience }) } as Scene;
}

function parseScenes(list: unknown): Scene[] | null {
  if (!Array.isArray(list)) return null;
  const scenes: Scene[] = [];
  for (const raw of list) {
    const scene = parseScene(raw);
    if (!scene) return null;
    scenes.push(scene);
  }
  return scenes;
}

export function parseBoard(value: unknown): ParseResult {
  const v = value as Record<string, unknown> | null;
  if (typeof v !== 'object' || v === null) return { ok: false, error: 'not an object' };
  if (v.version !== 2) return { ok: false, error: `unsupported version ${String(v.version)}` };
  const scenes = parseScenes(v.scenes);
  return scenes ? { ok: true, board: { version: 2, scenes } } : { ok: false, error: 'malformed scene' };
}

/** v1 held several sets; the Board becomes the set that was current. */
export function migrateV1(value: unknown): ParseResult {
  const v = value as Record<string, unknown> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.sets) || v.sets.length === 0) return { ok: false, error: 'not a v1 document' };
  const sets = v.sets as Record<string, unknown>[];
  const current = sets.find((s) => s?.id === v.currentId) ?? sets[0];
  const scenes = parseScenes(current?.scenes);
  return scenes ? { ok: true, board: { version: 2, scenes } } : { ok: false, error: 'malformed v1 scene' };
}

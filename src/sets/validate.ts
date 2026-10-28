// Validates the Board document loaded from localStorage, so a corrupt or hand-edited
// value can't break the app.

import type { Scene, SessionSet, SetsDoc } from './sets';

export type ParseResult = { ok: true; doc: SetsDoc } | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const PLAYLIST_ID = /^[A-Za-z0-9]{1,64}$/;

/** Validate and normalise. Unknown fields are dropped. */
export function parseDoc(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null) return { ok: false, error: 'Not a JSON object.' };
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return { ok: false, error: `Unsupported version: ${String(v.version)}.` };
  if (!Array.isArray(v.sets) || v.sets.length === 0) return { ok: false, error: 'No session sets in the file.' };

  const sets: SessionSet[] = [];
  for (const [i, raw] of v.sets.entries()) {
    const s = raw as Record<string, unknown>;
    if (!s || !isString(s.id) || !isString(s.name) || !Array.isArray(s.scenes)) {
      return { ok: false, error: `Set ${i + 1} is malformed.` };
    }
    const scenes: Scene[] = [];
    for (const rawScene of s.scenes) {
      const sc = rawScene as Record<string, unknown>;
      if (!sc || !isString(sc.id) || !isString(sc.playlistId) || !PLAYLIST_ID.test(sc.playlistId) || typeof sc.name !== 'string') {
        return { ok: false, error: `Set "${s.name}" has a malformed scene.` };
      }
      scenes.push({ id: sc.id, playlistId: sc.playlistId, name: sc.name });
    }
    sets.push({ id: s.id, name: s.name, scenes });
  }
  const currentId = isString(v.currentId) && sets.some((s) => s.id === v.currentId) ? v.currentId : sets[0].id;
  return { ok: true, doc: { version: 1, currentId, sets } };
}

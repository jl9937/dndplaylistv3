// Filing a track from the holding playlist (US-5-3): copy it into a tagged playlist without
// making a duplicate, and undo that copy without touching a copy that was already there.
// Moving it out of the holding playlist reuses skipRemove's removeTrack / restoreTrack.

import { addToPlaylist, getPlaylistTracks, removeFromPlaylist } from '../spotify/api';
import type { Track } from '../spotify/types';

interface Deps {
  getTracks?: (playlistId: string) => Promise<Track[]>;
  add?: (playlistId: string, uris: string[]) => Promise<void>;
  remove?: (playlistId: string, uris: string[]) => Promise<void>;
}

const uri = (trackId: string) => `spotify:track:${trackId}`;

/** Copy a track into a playlist, unless it's already there (checked fresh, not from the scan). */
export async function fileTrack(trackId: string, playlistId: string, deps: Deps = {}): Promise<'copied' | 'already'> {
  const tracks = await (deps.getTracks ?? getPlaylistTracks)(playlistId);
  if (tracks.some((t) => t.id === trackId)) return 'already';
  await (deps.add ?? addToPlaylist)(playlistId, [uri(trackId)]);
  return 'copied';
}

/**
 * Undo a copy. Spotify removes every copy of a track at once, so this only removes it when
 * it's there exactly once: a copy that was there before must never go with it.
 */
export async function unfileTrack(trackId: string, playlistId: string, deps: Deps = {}): Promise<void> {
  const count = (await (deps.getTracks ?? getPlaylistTracks)(playlistId)).filter((t) => t.id === trackId).length;
  if (count > 1) throw new Error('It’s in that playlist more than once now, so nothing was removed. Remove the extra copy in Spotify.');
  if (count === 1) await (deps.remove ?? removeFromPlaylist)(playlistId, [uri(trackId)]);
}

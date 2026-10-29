// Skip and remove (D31 #1): a track that doesn't fit is skipped and taken out of the playing
// playlist, for good. Undo puts it back where it was. Only for playlists I own.

import { hasScope } from '../auth/auth';
import { WRITE_SCOPES } from '../config';
import { addToPlaylist, getPlaylistTracks, removeFromPlaylist } from '../spotify/api';
import type { PlaybackState, Playlist, Track } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';

export interface RemoveTarget {
  playlistId: string;
  playlistName: string;
  trackId: string;
  trackName: string;
}

/** What Skip and remove would act on now, or why it can't. */
export function removeTarget(
  state: PlaybackState | null | undefined,
  byId: Map<string, Playlist>,
  myId: string | null,
): RemoveTarget | { reason: string } {
  const item = state?.item;
  if (!item?.id) return { reason: 'Nothing is playing.' };
  const playlistId = parsePlaylistId(state?.context?.uri);
  if (!playlistId) return { reason: 'Only works while a playlist is playing.' };
  const p = byId.get(playlistId);
  if (!p) return { reason: 'This playlist isn’t in your library.' };
  if (p.owner.id !== myId) return { reason: 'Spotify only lets you remove tracks from your own playlists.' };
  return { playlistId, playlistName: p.name, trackId: item.id, trackName: item.name ?? 'This track' };
}

/** Has Spotify allowed this app to change playlists? Tokens from before Milestone 5 haven't. */
export const canWritePlaylists = () => WRITE_SCOPES.every(hasScope);

const uri = (trackId: string) => `spotify:track:${trackId}`;

interface Deps {
  getTracks?: (playlistId: string) => Promise<Track[]>;
  remove?: (playlistId: string, uris: string[]) => Promise<void>;
  add?: (playlistId: string, uris: string[], position?: number) => Promise<void>;
}

/**
 * Remove the track. Spotify removes every copy of it, so this returns every position it was
 * at, for Undo.
 */
export async function removeTrack(t: RemoveTarget, deps: Deps = {}): Promise<number[]> {
  const tracks = await (deps.getTracks ?? getPlaylistTracks)(t.playlistId);
  const positions = tracks.filter((x) => x.id === t.trackId).map((x) => x.position);
  if (positions.length === 0) throw new Error('That track is no longer in the playlist.');
  await (deps.remove ?? removeFromPlaylist)(t.playlistId, [uri(t.trackId)]);
  return positions;
}

/** Undo: put every copy back at its old position (lowest first, so each lands where it was). */
export async function restoreTrack(t: RemoveTarget, positions: number[], deps: Deps = {}): Promise<void> {
  for (const at of [...positions].sort((a, b) => a - b)) await (deps.add ?? addToPlaylist)(t.playlistId, [uri(t.trackId)], at);
}

/** Is Spotify still playing this track from this playlist? Checked just before removing. */
export function stillPlaying(t: RemoveTarget, state: PlaybackState | null | undefined): boolean {
  return state?.item?.id === t.trackId && parsePlaylistId(state?.context?.uri) === t.playlistId;
}

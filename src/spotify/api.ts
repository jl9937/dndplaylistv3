import { request, type RequestOptions } from './client';
import type { Device, Me, Paging, PlaybackState, Playlist, PlaylistEntry, Track } from './types';

type Opts = Pick<RequestOptions, 'signal' | 'retry5xx'>;

const q = (deviceId: string) => `device_id=${encodeURIComponent(deviceId)}`;

export async function getMe(): Promise<Me> {
  return (await request<Me>('GET', '/me')).data!;
}

/** Every playlist in my library, following `next` until done. */
export async function getMyPlaylists(): Promise<Playlist[]> {
  const all: Playlist[] = [];
  let next: string | null = '/me/playlists?limit=50';
  while (next) {
    const page: Paging<Playlist | null> = (await request<Paging<Playlist | null>>('GET', next)).data!;
    // Spotify occasionally returns null entries for removed playlists.
    all.push(...page.items.filter((p): p is Playlist => p !== null));
    next = page.next;
  }
  return all;
}

/**
 * A playlist's tracks, in order. Only works for playlists I own or collaborate on (403
 * otherwise). Local files and podcast episodes are skipped: they have no features.
 */
export async function getPlaylistTracks(playlistId: string, opts: Opts = {}): Promise<Track[]> {
  const all: Track[] = [];
  let next: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`;
  let position = 0;
  while (next) {
    const page: Paging<PlaylistEntry | null> = (await request<Paging<PlaylistEntry | null>>('GET', next, opts)).data!;
    for (const e of page.items) {
      const t = e?.item ?? e?.track;
      const at = position++;
      if (!t?.id || e?.is_local || (t.type && t.type !== 'track')) continue;
      all.push({ id: t.id, name: t.name ?? '', artists: (t.artists ?? []).map((a) => a.name).join(', '), position: at });
    }
    next = page.next;
  }
  return all;
}

/** Remove every occurrence of these tracks from a playlist I own (D31). */
export async function removeFromPlaylist(playlistId: string, trackUris: string[], opts: Opts = {}): Promise<void> {
  const items = trackUris.map((uri) => ({ uri }));
  await request('DELETE', `/playlists/${encodeURIComponent(playlistId)}/items`, { ...opts, body: { items } });
}

/** Add tracks to a playlist, at a zero-based position, or at the end if none is given. */
export async function addToPlaylist(playlistId: string, trackUris: string[], position?: number, opts: Opts = {}): Promise<void> {
  const body: Record<string, unknown> = { uris: trackUris };
  if (position !== undefined) body.position = position;
  // No automatic 5xx retry: if the first attempt did land, a retry would add the track twice.
  await request('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, { retry5xx: false, ...opts, body });
}

export async function getDevices(opts: Opts = {}): Promise<Device[]> {
  return (await request<{ devices: Device[] }>('GET', '/me/player/devices', opts)).data?.devices ?? [];
}

/** null when nothing is active (204). */
export async function getPlaybackState(opts: Opts = {}): Promise<PlaybackState | null> {
  return (await request<PlaybackState>('GET', '/me/player', opts)).data;
}

export interface PlayRequest {
  contextUri: string;
  /** Zero-based track index to start from (D14). Omitted when the track count is unknown. */
  offsetPosition?: number;
}

export async function play(deviceId: string, req: PlayRequest, opts: Opts = {}): Promise<void> {
  const body: Record<string, unknown> = { context_uri: req.contextUri };
  if (req.offsetPosition !== undefined) body.offset = { position: req.offsetPosition };
  await request('PUT', `/me/player/play?${q(deviceId)}`, { ...opts, body });
}

export async function resume(deviceId: string, opts: Opts = {}): Promise<void> {
  await request('PUT', `/me/player/play?${q(deviceId)}`, opts);
}

export async function pause(deviceId: string, opts: Opts = {}): Promise<void> {
  await request('PUT', `/me/player/pause?${q(deviceId)}`, opts);
}

export async function next(deviceId: string, opts: Opts = {}): Promise<void> {
  await request('POST', `/me/player/next?${q(deviceId)}`, opts);
}

/** Make the device active without starting playback (the wake fallback, spec §12.4 step 6). */
export async function transfer(deviceId: string, opts: Opts = {}): Promise<void> {
  await request('PUT', '/me/player', { ...opts, body: { device_ids: [deviceId], play: false } });
}

/** Device volume, 0–100. Spotify rate-limits this; the fade uses only a few steps. */
export async function setVolume(deviceId: string, percent: number, opts: Opts = {}): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(percent)));
  await request('PUT', `/me/player/volume?volume_percent=${v}&${q(deviceId)}`, opts);
}

export async function setShuffle(deviceId: string, on: boolean, opts: Opts = {}): Promise<void> {
  await request('PUT', `/me/player/shuffle?state=${on}&${q(deviceId)}`, opts);
}

export async function setRepeat(
  deviceId: string,
  state: 'off' | 'track' | 'context',
  opts: Opts = {},
): Promise<void> {
  await request('PUT', `/me/player/repeat?state=${state}&${q(deviceId)}`, opts);
}

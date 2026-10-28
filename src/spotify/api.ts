import { request, type RequestOptions } from './client';
import type { Device, Me, Paging, PlaybackState, Playlist } from './types';

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

/** Make the device active without starting playback (the wake fallback, spec §12.4 step 6). */
export async function transfer(deviceId: string, opts: Opts = {}): Promise<void> {
  await request('PUT', '/me/player', { ...opts, body: { device_ids: [deviceId], play: false } });
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

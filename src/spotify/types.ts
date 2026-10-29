// Only the fields we use. Spotify's 2026 objects may lack fields older docs show.

export interface Image {
  url: string;
  width: number | null;
  height: number | null;
}

export interface Paging<T> {
  items: T[];
  next: string | null;
  total: number;
}

export interface Playlist {
  id: string;
  name: string;
  uri: string;
  images: Image[] | null;
  owner: { id: string; display_name?: string | null };
  /** 2026 field name. */
  items?: { total: number } | null;
  /** Legacy field name, still seen on some responses. */
  tracks?: { total: number } | null;
}

export interface Me {
  id: string;
  display_name?: string | null;
}

export interface Device {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
}

export interface PlaybackState {
  device: Device | null;
  is_playing: boolean;
  progress_ms: number | null;
  shuffle_state: boolean;
  repeat_state: 'off' | 'track' | 'context';
  context: { uri: string; type: string } | null;
  item: { id: string; name?: string; artists?: { name: string }[] } | null;
  timestamp?: number;
}

/** A playlist entry. `item` is the 2026 field; `track` is its deprecated twin. */
export interface PlaylistEntry {
  is_local?: boolean;
  item?: EntryTrack | null;
  track?: EntryTrack | null;
}
interface EntryTrack {
  id: string | null;
  type?: string;
  name?: string;
  artists?: { name: string }[];
}

/** The fields Studio uses from a playlist's track. */
export interface Track {
  id: string;
  name: string;
  artists: string;
  /** Index in the playlist, counting local files and episodes too: what Spotify's position means. */
  position: number;
}

export function trackCount(p: Playlist): number | undefined {
  return p.items?.total ?? p.tracks?.total ?? undefined;
}

export function songsLabel(p: Playlist): string | null {
  const n = trackCount(p);
  return n === undefined ? null : `${n} ${n === 1 ? 'song' : 'songs'}`;
}

/** The smallest image at least 96 px wide (sharp at 48 px on retina), else the first. */
export function pickCover(images: Image[] | null | undefined): Image | null {
  if (!images?.length) return null;
  const ok = images.filter((i) => (i.width ?? 0) >= 96).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return ok[0] ?? images[0];
}

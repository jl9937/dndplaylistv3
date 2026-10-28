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
  item: { id: string; name?: string } | null;
  timestamp?: number;
}

export function trackCount(p: Playlist): number | undefined {
  return p.items?.total ?? p.tracks?.total ?? undefined;
}

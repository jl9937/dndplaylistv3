import type { TileStatus } from '../playback/nowPlaying';
import type { PressState } from '../playback/pipeline';

/** What a row or tile shows: its status, plus the step text while starting. */
export interface ItemStatus {
  status: TileStatus;
  step?: string;
  reason?: string;
}

export function itemStatus(playlistId: string, press: PressState, status: TileStatus): ItemStatus {
  if (press.status === 'starting' && press.playlistId === playlistId) return { status, step: press.step };
  if (press.status === 'failed' && press.playlistId === playlistId) return { status, reason: press.reason };
  return { status };
}

export function StatusBadge({ s }: { s: ItemStatus }) {
  switch (s.status) {
    case 'idle':
      return null;
    case 'starting':
      return <span className="badge starting">{s.step ?? 'Starting…'}</span>;
    case 'playing':
      return <span className="badge playing">Playing</span>;
    case 'paused':
      return <span className="badge paused">Paused</span>;
    case 'failed':
      return <span className="badge failed">Failed</span>;
  }
}

import type { ReactNode } from 'react';
import { parsePlaylistName } from '../library/tags';
import type { NowPlaying } from '../playback/nowPlaying';
import type { PressState } from '../playback/pipeline';
import { boardOrder, KEYED_TILES, type SessionSet } from '../sets/sets';
import type { Playlist } from '../spotify/types';
import { Cover } from './Cover';
import { PlayerBar } from './PlayerBar';
import { StatusBadge, type ItemStatus } from './Status';

/** The narrow strip (spec §13.5). One component for docked compact mode and the floating window. */
export function Strip({
  set,
  byId,
  press,
  now,
  canControl,
  statusOf,
  notice,
  onPlay,
  onToggle,
  onNext,
  actions,
}: {
  set: SessionSet;
  byId: Map<string, Playlist>;
  press: PressState;
  now: NowPlaying;
  canControl: boolean;
  statusOf: (playlistId: string) => ItemStatus;
  notice: string | null;
  onPlay: (p: Playlist) => void;
  onToggle: () => void;
  onNext: () => void;
  /** Buttons for the header: Expand, Float, Back to app. */
  actions: ReactNode;
}) {
  const scenes = boardOrder(set);
  return (
    <div className="strip">
      <header className="strip-head">
        <strong>D&amp;D</strong>
        <span className="strip-actions">{actions}</span>
      </header>
      <PlayerBar press={press} now={now} byId={byId} canControl={canControl} onToggle={onToggle} onNext={onNext} />
      {notice && <p className="notice">{notice}</p>}
      {scenes.length === 0 && <p className="hint subtle">The Board is empty. Expand and use ☆ Add in the Library.</p>}
      <ol className="strip-tiles">
        {scenes.map((scene, i) => {
          const playlist = byId.get(scene.playlistId);
          const s = statusOf(scene.playlistId);
          const { tag, shortName } = parsePlaylistName(playlist?.name ?? scene.name);
          return (
            <li key={scene.id} className={`strip-tile ${s.status}`}>
              <button onClick={() => playlist && onPlay(playlist)} disabled={!playlist}>
                {i < KEYED_TILES ? <kbd>{i + 1}</kbd> : <span className="kbd-gap" />}
                <Cover images={playlist?.images} className="strip-cover" />
                <span className="strip-name">
                  {shortName}
                  {tag && <span className="strip-tag">{tag}</span>}
                </span>
                <StatusBadge s={s} />
              </button>
              {s.status === 'failed' && s.reason && <span className="strip-failure">{s.reason}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

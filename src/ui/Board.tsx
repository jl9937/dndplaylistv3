import { useState } from 'react';
import { describePlaylist } from '../library/tags';
import { KEYED_TILES, sections, type BoardDoc, type Scene } from '../board/board';
import type { Playlist } from '../spotify/types';
import { Cover } from './Cover';
import { StatusBadge, type ItemStatus } from './Status';

export function Board({
  board,
  byId,
  statusOf,
  onPlay,
  onRemove,
  onMoveScene,
  onMoveSection,
  onOpenLibrary,
}: {
  board: BoardDoc;
  byId: Map<string, Playlist>;
  statusOf: (playlistId: string) => ItemStatus;
  onPlay: (scene: Scene) => void;
  onRemove: (sceneId: string) => void;
  onMoveScene: (sceneId: string, targetSceneId: string) => void;
  onMoveSection: (key: string, dir: -1 | 1) => void;
  onOpenLibrary: () => void;
}) {
  const [dragging, setDragging] = useState<{ sceneId: string; section: string } | null>(null);
  const list = sections(board);

  if (list.length === 0) {
    return (
      <section className="board empty">
        <p>The Board is empty.</p>
        <p>
          Use <strong>☆ Add</strong> in the <button className="link" onClick={onOpenLibrary}>Library</button> to put
          playlists here.
        </p>
      </section>
    );
  }

  let n = 0;
  return (
    <section className="board">
      {board.scenes.length > KEYED_TILES && (
        <p className="hint subtle">Only the first {KEYED_TILES} tiles have number keys.</p>
      )}
      {list.map((section, si) => (
        <div className="board-section" key={section.key || 'untagged'}>
          <header>
            <h2>{section.label}</h2>
            <span className="section-moves">
              <button className="icon" onClick={() => onMoveSection(section.key, -1)} disabled={si === 0} aria-label={`Move ${section.label} up`}>
                ↑
              </button>
              <button
                className="icon"
                onClick={() => onMoveSection(section.key, 1)}
                disabled={si === list.length - 1}
                aria-label={`Move ${section.label} down`}
              >
                ↓
              </button>
            </span>
          </header>
          <ol className="tiles">
            {section.scenes.map((scene) => {
              n++;
              return (
                <Tile
                  key={scene.id}
                  scene={scene}
                  number={n <= KEYED_TILES ? n : null}
                  playlist={byId.get(scene.playlistId)}
                  status={statusOf(scene.playlistId)}
                  dropTarget={!!dragging && dragging.section === section.key && dragging.sceneId !== scene.id}
                  onPlay={onPlay}
                  onRemove={() => onRemove(scene.id)}
                  onDragStart={() => setDragging({ sceneId: scene.id, section: section.key })}
                  onDragEnd={() => setDragging(null)}
                  onDrop={() => {
                    if (dragging && dragging.section === section.key) onMoveScene(dragging.sceneId, scene.id);
                    setDragging(null);
                  }}
                />
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}

function Tile({
  scene,
  number,
  playlist,
  status,
  dropTarget,
  onPlay,
  onRemove,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  scene: Scene;
  number: number | null;
  playlist: Playlist | undefined;
  status: ItemStatus;
  dropTarget: boolean;
  onPlay: (scene: Scene) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const { shortName } = describePlaylist(playlist?.name ?? scene.name);
  return (
    <li
      className={`tile ${status.status}${dropTarget ? ' drop-target' : ''}${playlist ? '' : ' unavailable'}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', scene.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (dropTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <button className="tile-play" onClick={() => onPlay(scene)} disabled={!playlist}>
        <Cover images={playlist?.images} className="tile-cover" />
        <span className="tile-name">{shortName}</span>
        {number !== null && <kbd className="tile-key">{number}</kbd>}
        <StatusBadge s={status} />
      </button>
      {!playlist && <span className="tile-note">Not in your library any more</span>}
      {status.status === 'failed' && status.reason && (
        <span className="tile-failure">
          {status.reason} <button onClick={() => onPlay(scene)}>Try again</button>
        </span>
      )}
      <button className="icon tile-remove" onClick={onRemove} aria-label={`Remove ${shortName} from the Board`} title="Remove from the Board">
        ×
      </button>
    </li>
  );
}

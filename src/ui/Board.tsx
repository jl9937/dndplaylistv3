import { useState } from 'react';
import { describePlaylist } from '../library/tags';
import type { PresetLayer } from '../ambience/engine';
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
  ambience,
}: {
  board: BoardDoc;
  byId: Map<string, Playlist>;
  statusOf: (playlistId: string) => ItemStatus;
  onPlay: (scene: Scene) => void;
  onRemove: (sceneId: string) => void;
  onMoveScene: (sceneId: string, targetSceneId: string) => void;
  onMoveSection: (key: string, dir: -1 | 1) => void;
  onOpenLibrary: () => void;
  ambience: TileAmbience;
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
                  ambience={ambience}
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
  ambience,
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
  ambience: TileAmbience;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const { shortName } = describePlaylist(playlist?.name ?? scene.name);
  const [editing, setEditing] = useState(false);
  const preset = scene.ambience ?? [];
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
        {preset.length > 0 && <span className="tile-ambience">≈ {ambience.names(preset)}</span>}
        {number !== null && <kbd className="tile-key">{number}</kbd>}
        <StatusBadge s={status} />
      </button>
      {!playlist && <span className="tile-note">Not in your library any more</span>}
      {status.status === 'failed' && status.reason && (
        <span className="tile-failure">
          {status.reason} <button onClick={() => onPlay(scene)}>Try again</button>
        </span>
      )}
      {editing && (
        <span className="tile-ambience-menu">
          <button
            onClick={() => {
              ambience.save(scene.id, ambience.current);
              setEditing(false);
            }}
            disabled={ambience.current.length === 0}
            title={ambience.current.length === 0 ? 'Turn on some layers in the Ambience tab first' : undefined}
          >
            {ambience.current.length === 0 ? 'Nothing playing to save' : `Save current: ${ambience.names(ambience.current)}`}
          </button>
          {preset.length > 0 && (
            <button
              onClick={() => {
                ambience.save(scene.id, []);
                setEditing(false);
              }}
            >
              Remove ambience
            </button>
          )}
        </span>
      )}
      <button
        className={`icon tile-ambience-edit${preset.length > 0 ? ' on' : ''}`}
        onClick={() => setEditing((v) => !v)}
        aria-expanded={editing}
        aria-label={`Ambience for ${shortName}`}
        title="Ambience for this tile"
      >
        ≈
      </button>
      <button className="icon tile-remove" onClick={onRemove} aria-label={`Remove ${shortName} from the Board`} title="Remove from the Board">
        ×
      </button>
    </li>
  );
}

/** What a tile needs to show and save its ambience preset (D30). */
export interface TileAmbience {
  /** The layers playing now: what Save would store. */
  current: PresetLayer[];
  names: (preset: PresetLayer[]) => string;
  save: (sceneId: string, preset: PresetLayer[]) => void;
}

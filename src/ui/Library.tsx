import { useMemo, useState } from 'react';
import type { LibraryState } from '../library/libraryStore';
import { groupByTag, parsePlaylistName } from '../library/tags';
import type { Playlist } from '../spotify/types';
import { Cover } from './Cover';
import { StatusBadge, type ItemStatus } from './Status';

export function Library({
  library,
  statusOf,
  inSet,
  onPlay,
  onToggleSet,
  onRetry,
  onChooseDevice,
}: {
  library: LibraryState;
  statusOf: (playlistId: string) => ItemStatus;
  inSet: (playlistId: string) => boolean;
  onPlay: (p: Playlist) => void;
  onToggleSet: (p: Playlist) => void;
  onRetry: () => void;
  onChooseDevice: () => void;
}) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    if (library.status !== 'ok') return [];
    const f = filter.trim().toLocaleLowerCase();
    const shown = f ? library.playlists.filter((p) => p.name.toLocaleLowerCase().includes(f)) : library.playlists;
    return groupByTag(shown, (p) => p.name);
  }, [library, filter]);

  if (library.status === 'loading') return <p className="state">Loading playlists…</p>;
  if (library.status === 'error') {
    return (
      <p className="state error">
        Couldn’t load playlists: {library.message} <button onClick={onRetry}>Retry</button>
      </p>
    );
  }

  return (
    <section className="library">
      <input
        className="filter"
        type="search"
        placeholder={`Filter ${library.playlists.length} playlists…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter playlists"
      />
      {library.refreshError && (
        <p className="hint subtle">
          Showing saved playlists; refreshing failed ({library.refreshError}). <button className="link" onClick={onRetry}>Retry</button>
        </p>
      )}
      {groups.map((g) => (
        <div className="library-group" key={g.key || 'untagged'}>
          <h2>
            {g.label} <span className="count">{g.items.length}</span>
          </h2>
          <ul className="playlists">
            {g.items.map((p) => {
              const s = statusOf(p.id);
              const starred = inSet(p.id);
              return (
                <li key={p.id} className={`row ${s.status}`}>
                  <div className="row-main">
                    <button className="play" onClick={() => onPlay(p)}>
                      <Cover images={p.images} />
                      <span className="meta">
                        <span className="name">{parsePlaylistName(p.name).shortName}</span>
                        {p.owner.id !== library.myId && (
                          <span className="owner">by {p.owner.display_name ?? p.owner.id}</span>
                        )}
                      </span>
                      <StatusBadge s={s} />
                    </button>
                    <button
                      className={`icon star${starred ? ' on' : ''}`}
                      onClick={() => onToggleSet(p)}
                      aria-pressed={starred}
                      aria-label={starred ? 'Remove from current set' : 'Add to current set'}
                      title={starred ? 'Remove from current set' : 'Add to current set'}
                    >
                      {starred ? '★' : '☆'}
                    </button>
                  </div>
                  {s.status === 'failed' && (
                    <div className="failure">
                      <span>{s.reason}</span>
                      <button onClick={() => onPlay(p)}>Try again</button>
                      <button onClick={onChooseDevice}>Choose another device</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {groups.length === 0 && <p className="state">No playlists match “{filter}”.</p>}
    </section>
  );
}

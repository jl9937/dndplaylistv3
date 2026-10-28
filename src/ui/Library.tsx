import { useMemo, useState } from 'react';
import type { LibraryState } from '../library/libraryStore';
import { groupByTag, parsePlaylistName } from '../library/tags';
import { trackCount, type Playlist } from '../spotify/types';
import { Cover } from './Cover';
import { StatusBadge, type ItemStatus } from './Status';

export function songs(p: Playlist): string | null {
  const n = trackCount(p);
  return n === undefined ? null : `${n} ${n === 1 ? 'song' : 'songs'}`;
}

export function Library({
  library,
  showUntagged,
  onShowUntagged,
  statusOf,
  inSet,
  onPlay,
  onToggleSet,
  onRetry,
  onChooseDevice,
}: {
  library: LibraryState;
  showUntagged: boolean;
  onShowUntagged: (show: boolean) => void;
  statusOf: (playlistId: string) => ItemStatus;
  inSet: (playlistId: string) => boolean;
  onPlay: (p: Playlist) => void;
  onToggleSet: (p: Playlist) => void;
  onRetry: () => void;
  onChooseDevice: () => void;
}) {
  const [filter, setFilter] = useState('');
  const { groups, untagged } = useMemo(() => {
    if (library.status !== 'ok') return { groups: [], untagged: 0 };
    const f = filter.trim().toLocaleLowerCase();
    const matching = f ? library.playlists.filter((p) => p.name.toLocaleLowerCase().includes(f)) : library.playlists;
    const all = groupByTag(matching, (p) => p.name);
    const untaggedGroup = all.find((g) => g.key === '');
    return {
      groups: showUntagged ? all : all.filter((g) => g.key !== ''),
      untagged: untaggedGroup?.items.length ?? 0,
    };
  }, [library, filter, showUntagged]);

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
        placeholder="Filter playlists…"
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
                        <span className="owner">
                          {[songs(p), p.owner.id !== library.myId ? `by ${p.owner.display_name ?? p.owner.id}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <StatusBadge s={s} />
                    </button>
                    <button
                      className={`fav${starred ? ' on' : ''}`}
                      onClick={() => onToggleSet(p)}
                      aria-pressed={starred}
                      title={starred ? 'Remove from the Board' : 'Add to the Board'}
                    >
                      <span aria-hidden>{starred ? '★' : '☆'}</span> {starred ? 'On Board' : 'Add to Board'}
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
      {groups.length === 0 && (
        <p className="state">{filter ? `No ${showUntagged ? '' : 'tagged '}playlists match “${filter}”.` : 'No tagged playlists.'}</p>
      )}
      {untagged > 0 && (
        <p className="hint subtle untagged-toggle">
          <button className="link" onClick={() => onShowUntagged(!showUntagged)}>
            {showUntagged ? `Hide ${untagged} untagged` : `Show ${untagged} untagged`}
          </button>{' '}
          (playlists without a <code>Tag:</code> prefix)
        </p>
      )}
    </section>
  );
}

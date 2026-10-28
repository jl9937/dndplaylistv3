import { useMemo, useState } from 'react';
import type { LibraryState } from '../library/libraryStore';
import { describePlaylist, groupByTag } from '../library/tags';
import { trackCount, type Playlist } from '../spotify/types';
import { read, write } from '../storage';
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
  // Tag pills: toggles that narrow the Library to some tags. None selected shows all.
  const [picked, setPickedState] = useState<Set<string>>(() => new Set(read<string[]>('prefs.libraryTags') ?? []));
  const setPicked = (fn: (prev: Set<string>) => Set<string>) =>
    setPickedState((prev) => {
      const next = fn(prev);
      write('prefs.libraryTags', [...next]);
      return next;
    });
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { groups, pills, untagged } = useMemo(() => {
    if (library.status !== 'ok') return { groups: [], pills: [], untagged: 0 };
    const shown = library.playlists.filter((p) => !describePlaylist(p.name).hidden);
    const all = groupByTag(shown, (p) => p.name);
    const untaggedCount = all.find((g) => g.key === '')?.items.length ?? 0;
    const pillGroups = showUntagged ? all : all.filter((g) => g.key !== '');
    const f = filter.trim().toLocaleLowerCase();
    const active = pillGroups.some((g) => picked.has(g.key));
    const visible = pillGroups
      .filter((g) => !active || picked.has(g.key))
      .map((g) => ({ ...g, items: f ? g.items.filter((p) => p.name.toLocaleLowerCase().includes(f)) : g.items }))
      .filter((g) => g.items.length > 0);
    return { groups: visible, pills: pillGroups, untagged: untaggedCount };
  }, [library, filter, showUntagged, picked]);
  const anyPicked = pills.some((g) => picked.has(g.key));

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
      {pills.length > 1 && (
        <div className="pills" role="group" aria-label="Show only these tags">
          {pills.map((g) => (
            <button
              key={g.key || 'untagged'}
              className={`pill${picked.has(g.key) ? ' on' : ''}`}
              aria-pressed={picked.has(g.key)}
              onClick={() => toggle(g.key)}
            >
              {g.label} <span className="count">{g.items.length}</span>
            </button>
          ))}
          {anyPicked && (
            <button className="link" onClick={() => setPicked(() => new Set())}>
              Show all
            </button>
          )}
        </div>
      )}
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
                        <span className="name">{describePlaylist(p.name).shortName}</span>
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
                      <span aria-hidden>{starred ? '★' : '☆'}</span> {starred ? 'On Board' : 'Add'}
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
          (no <code>Tag:</code> or <code>[Tag]</code> in the name)
        </p>
      )}
    </section>
  );
}

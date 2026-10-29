import { useMemo, useState } from 'react';
import type { LibraryState } from '../library/libraryStore';
import { tagColour } from '../library/tagColour';
import { describePlaylist, groupByTag, isListed, parsePlaylistName, tagKey, tagLabels } from '../library/tags';
import { songsLabel, type Playlist } from '../spotify/types';
import { read, write } from '../storage';
import { Menu } from './Menu';
import { StatusBadge, type ItemStatus } from './Status';
import { TagPicker, useRename } from './TagPicker';

export function Library({
  library,
  showUntagged,
  onShowUntagged,
  statusOf,
  isOnBoard,
  onPlay,
  onToggleBoard,
  onRetry,
  onChooseDevice,
}: {
  library: LibraryState;
  showUntagged: boolean;
  onShowUntagged: (show: boolean) => void;
  statusOf: (playlistId: string) => ItemStatus;
  isOnBoard: (playlistId: string) => boolean;
  onPlay: (p: Playlist) => void;
  onToggleBoard: (p: Playlist) => void;
  onRetry: () => void;
  onChooseDevice: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [tagging, setTagging] = useState<string | null>(null);
  const rename = useRename();
  // The tag sidebar: toggles that narrow the Library to some tags. None selected shows all.
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
    const shown = library.playlists.filter((p) => isListed(p.name, true));
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
  const allTags = useMemo(
    () => (library.status === 'ok' ? [...tagLabels(library.playlists.map((p) => p.name)).values()].sort((a, b) => a.localeCompare(b)) : []),
    [library],
  );

  if (library.status === 'loading') return <p className="state">Loading playlists…</p>;
  if (library.status === 'error') {
    return (
      <p className="state error">
        Couldn’t load playlists: {library.message} <button onClick={onRetry}>Retry</button>
      </p>
    );
  }

  const totalShown = pills.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="library">
      <nav className="lib-side" aria-label="Tags">
        <h4>Tags</h4>
        <button className={anyPicked ? '' : 'on'} aria-pressed={!anyPicked} onClick={() => setPicked(() => new Set())}>
          All playlists <span className="count">{totalShown}</span>
        </button>
        {pills.map((g) => (
          <button key={g.key || 'untagged'} className={picked.has(g.key) ? 'on' : ''} aria-pressed={picked.has(g.key)} onClick={() => toggle(g.key)}>
            <span className="tag-dot" style={{ background: tagColour(g.key ? g.label : null) }} aria-hidden />
            {g.label} <span className="count">{g.items.length}</span>
          </button>
        ))}
        {untagged > 0 && (
          <button className="lib-untagged" onClick={() => onShowUntagged(!showUntagged)} title="Playlists with no Tag: or [Tag] in the name">
            {showUntagged ? `Hide ${untagged} untagged` : `Show ${untagged} untagged`}
          </button>
        )}
      </nav>

      <div className="lib-main">
        <input
          className="filter"
          type="search"
          placeholder="Filter playlists…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter playlists"
        />
        {anyPicked && (
          <p className="lib-showing">
            Showing{' '}
            {pills
              .filter((g) => picked.has(g.key))
              .map((g) => (
                <span key={g.key || 'untagged'} className="chip">
                  {g.label}
                  <button className="icon" onClick={() => toggle(g.key)} aria-label={`Stop showing only ${g.label}`}>
                    ×
                  </button>
                </span>
              ))}
          </p>
        )}
        {rename.line}
        {library.refreshError && (
          <p className="hint subtle">
            Showing saved playlists; refreshing failed ({library.refreshError}).{' '}
            <button className="link" onClick={onRetry}>
              Retry
            </button>
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
                const starred = isOnBoard(p.id);
                const mine = p.owner.id === library.myId;
                const key = `${g.key}:${p.id}`; // a playlist with several tags appears in several groups
                const d = describePlaylist(p.name);
                const prefix = parsePlaylistName(p.name).tag;
                const others = d.tags.filter((t) => tagKey(t) !== g.key);
                return (
                  <li key={p.id} className={`row ${s.status}`}>
                    <div className="row-main">
                      <button className="play" onClick={() => onPlay(p)} title={`Play ${p.name}`}>
                        <TagSquare name={d.shortName} tag={d.tags[0] ?? null} />
                        <span className="meta">
                          <span className="name">
                            {prefix && <span className="name-prefix">{prefix}: </span>}
                            {d.shortName}
                          </span>
                          <span className="owner">
                            {[songsLabel(p), others.length ? others.join(', ') : null, mine ? null : `by ${p.owner.display_name ?? p.owner.id}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <StatusBadge s={s} />
                      </button>
                      <button
                        className={`star${starred ? ' on' : ''}`}
                        onClick={() => onToggleBoard(p)}
                        aria-pressed={starred}
                        aria-label={starred ? `Remove ${d.shortName} from the Board` : `Add ${d.shortName} to the Board`}
                        title={starred ? 'On the Board: click to remove' : 'Add to the Board'}
                      >
                        <span aria-hidden>{starred ? '★' : '☆'}</span>
                      </button>
                      <Menu label={`More for ${d.shortName}`} className="card-menu">
                        {(close) => (
                          <>
                            <button
                              role="menuitem"
                              onClick={() => {
                                close();
                                onPlay(p);
                              }}
                            >
                              <span aria-hidden>▶</span> Play now
                            </button>
                            {mine && (
                              <button
                                role="menuitem"
                                onClick={() => {
                                  close();
                                  setTagging(key);
                                }}
                              >
                                Edit tags… <span className="menu-hint">renames it in Spotify</span>
                              </button>
                            )}
                            <a role="menuitem" className="menu-link" href={`https://open.spotify.com/playlist/${p.id}`} target="_blank" rel="noreferrer" onClick={close}>
                              Open in Spotify
                            </a>
                          </>
                        )}
                      </Menu>
                    </div>
                    {tagging === key && (
                      <TagPicker
                        playlist={p}
                        allTags={allTags}
                        busy={rename.saving}
                        onRename={(change) => void rename.apply(p.id, change).then((ok) => ok && setTagging(null))}
                        onClose={() => setTagging(null)}
                      />
                    )}
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
      </div>
    </section>
  );
}

/** The card's art (UI direction B): a square in its first tag's colour, with the name's first letter. */
function TagSquare({ name, tag }: { name: string; tag: string | null }) {
  const letter = [...name.replace(/^the\s+/i, '').trim()][0]?.toLocaleUpperCase() ?? '?';
  return (
    <span className="tag-square" style={{ background: tagColour(tag) }} aria-hidden>
      {letter}
    </span>
  );
}

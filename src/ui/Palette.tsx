import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { search } from '../library/search';
import { groupByTag, labelFor, parsePlaylistName, tagKey, tagLabels } from '../library/tags';
import type { Playlist } from '../spotify/types';
import { Cover } from './Cover';

const MAX_RESULTS = 60;

interface Group {
  key: string;
  label: string;
  items: Playlist[];
}

/** With a query: groups ordered by their best match. Without: the Library's A–Z grouping. */
function grouped(playlists: Playlist[], query: string): Group[] {
  if (!query.trim()) return groupByTag(playlists, (p) => p.name);
  const ranked = search(playlists, query, (p) => p.name).slice(0, MAX_RESULTS);
  const labels = tagLabels(playlists.map((p) => p.name));
  const groups: Group[] = [];
  for (const p of ranked) {
    const key = tagKey(parsePlaylistName(p.name).tag);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: labelFor(key, labels), items: [] }));
    g.items.push(p);
  }
  return groups;
}

export function Palette({
  playlists,
  inSet,
  onPlay,
  onToggleSet,
  onClose,
}: {
  playlists: Playlist[];
  inSet: (playlistId: string) => boolean;
  onPlay: (p: Playlist) => void;
  onToggleSet: (p: Playlist) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => grouped(playlists, query), [playlists, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  const play = (p: Playlist | undefined) => {
    if (!p) return;
    onPlay(p);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (current) onToggleSet(current);
      } else play(current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Quick switch">
        <input
          autoFocus
          className="palette-input"
          type="search"
          placeholder="Play any playlist…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={current ? `pal-${current.id}` : undefined}
        />
        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {groups.map((g) => (
            <div key={g.key || 'untagged'} role="group" aria-label={g.label}>
              <div className="palette-group">{g.label}</div>
              {g.items.map((p) => {
                const selected = p === current;
                const starred = inSet(p.id);
                return (
                  <div
                    key={p.id}
                    id={`pal-${p.id}`}
                    role="option"
                    aria-selected={selected}
                    className={`palette-row${selected ? ' active' : ''}`}
                    onMouseMove={() => setActive(flat.indexOf(p))}
                    onClick={() => play(p)}
                  >
                    <Cover images={p.images} className="palette-cover" />
                    <span className="palette-name">{parsePlaylistName(p.name).shortName}</span>
                    <button
                      className={`icon star${starred ? ' on' : ''}`}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSet(p);
                      }}
                      aria-label={starred ? 'Remove from current set' : 'Add to current set'}
                    >
                      {starred ? '★' : '☆'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <p className="state">No playlists match “{query}”.</p>}
        </div>
        <footer className="palette-help">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Enter</kbd> play · <kbd>Shift</kbd>+<kbd>Enter</kbd> add to set · <kbd>Esc</kbd> close
        </footer>
      </div>
    </div>
  );
}

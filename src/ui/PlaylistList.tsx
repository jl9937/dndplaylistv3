import { useMemo, useState } from 'react';
import type { PressState } from '../playback/pipeline';
import type { Image, Playlist } from '../spotify/types';

export type Library =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; playlists: Playlist[] };

function thumb(images: Image[] | null): string | null {
  if (!images?.length) return null;
  const ok = images.filter((i) => (i.width ?? 0) >= 96).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (ok[0] ?? images[0]).url;
}

export function PlaylistList({
  library,
  myId,
  press,
  onPress,
  onRetry,
  onChooseDevice,
}: {
  library: Library;
  myId: string | null;
  press: PressState;
  onPress: (p: Playlist) => void;
  onRetry: () => void;
  onChooseDevice: () => void;
}) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    if (library.status !== 'ok') return [];
    const f = filter.trim().toLowerCase();
    return f ? library.playlists.filter((p) => p.name.toLowerCase().includes(f)) : library.playlists;
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
      <ul className="playlists">
        {shown.map((p) => {
          const mine = press.status !== 'idle' && press.playlistId === p.id ? press : null;
          const src = thumb(p.images);
          return (
            <li key={p.id} className={mine ? `row ${mine.status}` : 'row'}>
              <button className="play" onClick={() => onPress(p)}>
                {src ? <img src={src} alt="" loading="lazy" /> : <span className="cover-placeholder" aria-hidden />}
                <span className="meta">
                  <span className="name">{p.name}</span>
                  {myId && p.owner.id !== myId && (
                    <span className="owner">by {p.owner.display_name ?? p.owner.id}</span>
                  )}
                </span>
                {mine && <RowStatus state={mine} />}
              </button>
              {mine?.status === 'failed' && (
                <div className="failure">
                  <span>{mine.reason}</span>
                  <button onClick={() => onPress(p)}>Try again</button>
                  <button onClick={onChooseDevice}>Choose another device</button>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="state">No playlists match “{filter}”.</li>}
      </ul>
    </section>
  );
}

function RowStatus({ state }: { state: Exclude<PressState, { status: 'idle' }> }) {
  switch (state.status) {
    case 'starting':
      return <span className="badge starting">{state.step}</span>;
    case 'playing':
      return <span className="badge playing">Playing</span>;
    case 'paused':
      return <span className="badge paused">Paused</span>;
    case 'failed':
      return <span className="badge failed">Failed</span>;
  }
}

import { useEffect, useMemo, useState } from 'react';
import { startLogin } from '../auth/auth';
import { loadLibrary } from '../library/libraryStore';
import { canWritePlaylists } from '../playback/skipRemove';
import { addToPlaylist, getPlaylistTracks, removeFromPlaylist } from '../spotify/api';
import type { Playlist, Track } from '../spotify/types';
import type { PlaylistInput } from '../studio/coverage';
import { featuresFor } from '../studio/featureCache';
import type { Features } from '../studio/reccobeats';
import { buildIndex, SORTER_WEIGHTS, suggest } from '../studio/recommend';
import { usePref } from './hooks';

// Sort a holding playlist (US-5-3): for each of its tracks, the playlists it most likely
// belongs in, with the reason, and Copy. The holding playlist itself is never changed.

type Copy = { phase: 'copying' | 'copied' | 'undoing' } | { phase: 'failed'; error: string };

type Holding =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; playlistId: string; tracks: Track[]; features: Map<string, Features> }
  | { phase: 'error'; message: string };

/** How many suggestions to show per track. */
const SHOW = 3;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const uri = (trackId: string) => `spotify:track:${trackId}`;

export function Sorter({
  mine,
  scanned,
  scannedFeatures,
  onPlayAt,
}: {
  /** Every playlist I own, tagged or not: the choices for the holding playlist. */
  mine: Playlist[];
  /** The scanned playlists: where tracks can go. */
  scanned: PlaylistInput[];
  scannedFeatures: Map<string, Features>;
  onPlayAt: (p: Playlist, position: number) => void;
}) {
  const [holdingId, setHoldingId] = usePref<string | null>('prefs.sortHolding', null);
  const [holding, setHolding] = useState<Holding>({ phase: 'idle' });
  const [copies, setCopies] = useState<Record<string, Copy>>({});
  const [needsLogin, setNeedsLogin] = useState(false);
  const holdingPlaylist = mine.find((p) => p.id === holdingId);
  const choices = useMemo(() => [...mine].sort((a, b) => a.name.localeCompare(b.name)), [mine]);

  useEffect(() => {
    if (!holdingId) return;
    let live = true;
    setHolding({ phase: 'loading' });
    setCopies({});
    (async () => {
      const tracks = await getPlaylistTracks(holdingId);
      const features = await featuresFor(tracks.map((t) => t.id));
      if (live) setHolding({ phase: 'ok', playlistId: holdingId, tracks, features });
    })().catch((e: unknown) => live && setHolding({ phase: 'error', message: message(e) }));
    return () => {
      live = false;
    };
  }, [holdingId]);

  // Where tracks can go: the scanned playlists, never the holding playlist itself.
  const index = useMemo(() => {
    if (holding.phase !== 'ok') return null;
    const targets = scanned.filter((p) => p.id !== holding.playlistId);
    return buildIndex(targets, new Map([...scannedFeatures, ...holding.features]));
  }, [holding, scanned, scannedFeatures]);

  const key = (trackId: string, playlistId: string) => `${trackId}:${playlistId}`;
  const setCopy = (k: string, c: Copy | null) =>
    setCopies((all) => {
      const next = { ...all };
      if (c) next[k] = c;
      else delete next[k];
      return next;
    });

  function copy(t: Track, playlistId: string) {
    if (!canWritePlaylists()) return setNeedsLogin(true);
    const k = key(t.id, playlistId);
    setCopy(k, { phase: 'copying' });
    addToPlaylist(playlistId, [uri(t.id)]).then(
      () => {
        setCopy(k, { phase: 'copied' });
        void loadLibrary();
      },
      (e: unknown) => setCopy(k, { phase: 'failed', error: message(e) }),
    );
  }

  /** Undo a copy. Safe: a track is only offered for playlists it wasn't already in. */
  function undo(t: Track, playlistId: string) {
    const k = key(t.id, playlistId);
    setCopy(k, { phase: 'undoing' });
    removeFromPlaylist(playlistId, [uri(t.id)]).then(
      () => {
        setCopy(k, null);
        void loadLibrary();
      },
      (e: unknown) => setCopy(k, { phase: 'failed', error: `Couldn’t undo: ${message(e)}` }),
    );
  }

  const nameOf = (playlistId: string) => scanned.find((p) => p.id === playlistId)?.name ?? playlistId;

  return (
    <section className="sorter">
      <h2>Sort a holding playlist</h2>
      <p className="hint subtle">
        For each track, the playlists it most likely belongs in, from shared composers and albums (then how it sounds). Copy adds it there;
        the holding playlist isn’t changed. Right about half the time in the top 3, so give it a listen.
      </p>
      <label className="sorter-pick">
        Holding playlist{' '}
        <select value={holdingId ?? ''} onChange={(e) => setHoldingId(e.target.value || null)}>
          <option value="">Choose…</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {needsLogin && (
        <p className="removal warn" role="status">
          Spotify hasn’t allowed this app to change your playlists yet. Log in again once to allow it.{' '}
          <button onClick={() => void startLogin()}>Log in again</button>
        </p>
      )}
      {holding.phase === 'loading' && <p className="subtle">Reading the playlist…</p>}
      {holding.phase === 'error' && <p className="error">Couldn’t read it: {holding.message}</p>}
      {holding.phase === 'ok' && index && (
        <>
          <p className="subtle">{holding.tracks.length === 1 ? '1 track' : `${holding.tracks.length} tracks`}</p>
          <ul className="sorter-tracks">
            {holding.tracks.map((t) => {
              const already = index.playlists.filter((p) => p.ids.has(t.id)).map((p) => p.name);
              const ranked = suggest(t, index, SORTER_WEIGHTS);
              const top = ranked.filter((s) => s.score > 0).slice(0, SHOW);
              const others = ranked.filter((s) => !top.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
              // Every playlist with a copy under way, done or failed, so its state and Undo stay visible.
              const copied = Object.keys(copies)
                .filter((k) => k.startsWith(`${t.id}:`))
                .map((k) => k.slice(t.id.length + 1));
              const shown = new Set([...top.map((s) => s.playlistId), ...copied]);
              return (
                <li key={`${t.id}:${t.position}`} className="sorter-track">
                  <div className="sorter-head">
                    <span>
                      {t.name} <span className="subtle">— {t.artists}</span>
                      {already.length > 0 && <span className="sorter-already">Already in {already.join(', ')}</span>}
                    </span>
                    {holdingPlaylist && <button onClick={() => onPlayAt(holdingPlaylist, t.position)}>Play</button>}
                  </div>
                  <ul className="sorter-suggestions">
                    {[...shown].map((pid) => {
                      const s = top.find((x) => x.playlistId === pid);
                      const c = copies[key(t.id, pid)];
                      return (
                        <li key={pid}>
                          {c?.phase === 'copied' ? (
                            <>
                              <span className="ok">✓ Copied</span> <button onClick={() => undo(t, pid)}>Undo</button>
                            </>
                          ) : c?.phase === 'copying' || c?.phase === 'undoing' ? (
                            <span className="subtle">{c.phase === 'copying' ? 'Copying…' : 'Undoing…'}</span>
                          ) : (
                            <button onClick={() => copy(t, pid)}>Copy</button>
                          )}{' '}
                          {nameOf(pid)}
                          {s && s.reasons.length > 0 && <span className="subtle"> · {s.reasons.join(', ')}</span>}
                          {c?.phase === 'failed' && <span className="error"> {c.error}</span>}
                        </li>
                      );
                    })}
                    {top.length === 0 && copied.length === 0 && <li className="subtle">No suggestion: no shared composer or album, and no features.</li>}
                  </ul>
                  <select
                    className="sorter-other"
                    value=""
                    onChange={(e) => e.target.value && copy(t, e.target.value)}
                    aria-label={`Copy ${t.name} to another playlist`}
                  >
                    <option value="">Copy to another playlist…</option>
                    {others
                      .filter((s) => !shown.has(s.playlistId))
                      .map((s) => (
                        <option key={s.playlistId} value={s.playlistId}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

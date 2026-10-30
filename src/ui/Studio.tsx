import { useEffect, useState } from 'react';
import { startLogin } from '../auth/auth';
import { loadLibrary } from '../library/libraryStore';
import type { NowPlaying } from '../playback/nowPlaying';
import { canWritePlaylists, removeTrack, restoreTrack, type RemoveTarget } from '../playback/skipRemove';
import type { Playlist } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';
import { MIN_FOR_OUTLIERS, type Outlier, type PlaylistOutliers } from '../studio/outliers';
import { scan, stopScan } from '../studio/outlierScan';
import { evaluate, type EvalRow } from '../studio/recommend';
import { useOutlierScan, usePref } from './hooks';
import { Sorter } from './Sorter';

// The Studio tab (Milestone 5): a sidebar switching between sorting a holding playlist
// (US-5-3) and outlier review (US-5-2), with one shared scan (UI direction B). Nothing is
// changed without a click, and every change can be undone.

type Row =
  | { phase: 'removing' | 'restoring' }
  | { phase: 'removed'; positions: number[] }
  | { phase: 'failed'; error: string; positions?: number[] };

const keyOf = (playlistId: string, trackId: string) => `${playlistId}:${trackId}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Studio({
  playlists,
  mine,
  byId,
  now,
  onPlayAt,
}: {
  /** The playlists to scan: my own tagged ones. */
  playlists: Playlist[];
  /** Every playlist I own, for the sorter's holding playlist. */
  mine: Playlist[];
  byId: Map<string, Playlist>;
  now: NowPlaying;
  /** Play a playlist from a track. Called inside the click. */
  onPlayAt: (p: Playlist, trackId: string) => void;
}) {
  const state = useOutlierScan();
  const [kept, setKept] = usePref<string[]>('prefs.outliersKept', []);
  const [showKept, setShowKept] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [needsLogin, setNeedsLogin] = useState(false);
  const [view, setView] = usePref<'sort' | 'outliers'>('prefs.studioView', 'sort');
  const [holdingId, setHoldingId] = usePref<string | null>('prefs.sortHolding', null);

  // The first visit scans by itself: it only reads, and nothing here works without it.
  useEffect(() => {
    if (state.phase === 'idle' && playlists.length > 0) void scan(playlists);
    // Once, on opening Studio.
  }, []);
  const busy = state.phase === 'tracks' || state.phase === 'features';
  const keptSet = new Set(kept);
  const setRow = (key: string, row: Row | null) =>
    setRows((r) => {
      const next = { ...r };
      if (row) next[key] = row;
      else delete next[key];
      return next;
    });

  const playingId = now.state?.item?.id;
  const playingIn = parsePlaylistId(now.state?.context?.uri);

  function remove(p: PlaylistOutliers, o: Outlier) {
    if (!canWritePlaylists()) return setNeedsLogin(true);
    const key = keyOf(p.id, o.track.id);
    const target: RemoveTarget = { playlistId: p.id, playlistName: p.name, trackId: o.track.id, trackName: o.track.name };
    setRow(key, { phase: 'removing' });
    removeTrack(target).then(
      (positions) => {
        setRow(key, { phase: 'removed', positions });
        void loadLibrary();
      },
      (e: unknown) => setRow(key, { phase: 'failed', error: message(e) }),
    );
  }

  function undo(p: PlaylistOutliers, o: Outlier, positions: number[]) {
    const key = keyOf(p.id, o.track.id);
    const target: RemoveTarget = { playlistId: p.id, playlistName: p.name, trackId: o.track.id, trackName: o.track.name };
    setRow(key, { phase: 'restoring' });
    restoreTrack(target, positions).then(
      () => {
        setRow(key, null);
        void loadLibrary();
      },
      (e: unknown) => setRow(key, { phase: 'failed', error: `Couldn’t put it back: ${message(e)}`, positions }),
    );
  }

  const keep = (key: string) => setKept([...kept.filter((k) => k !== key), key]);
  const unkeep = (key: string) => setKept(kept.filter((k) => k !== key));

  const done = state.phase === 'done' ? state : null;
  const visible = (p: PlaylistOutliers) => p.outliers.filter((o) => showKept || !keptSet.has(keyOf(p.id, o.track.id)));
  const withSuggestions = done ? [...done.playlists].filter((p) => visible(p).length > 0).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const total = done ? done.playlists.reduce((a, p) => a + p.outliers.filter((o) => !keptSet.has(keyOf(p.id, o.track.id))).length, 0) : 0;
  const keptCount = done ? done.playlists.reduce((a, p) => a + p.outliers.filter((o) => keptSet.has(keyOf(p.id, o.track.id))).length, 0) : 0;

  const holdingName = mine.find((p) => p.id === holdingId)?.name;
  const scanLine =
    state.phase === 'tracks' ? (
      <>Reading playlists… {state.done} / {state.of}</>
    ) : state.phase === 'features' ? (
      <>Looking up new tracks… {state.done} / {state.of}</>
    ) : done ? (
      <>Scanned {ago(done.at)}</>
    ) : (
      <>Not scanned yet</>
    );

  return (
    <section className="studio">
      <nav className="studio-side" aria-label="Studio">
        <h4>Studio</h4>
        <button className={view === 'sort' ? 'on' : ''} aria-current={view === 'sort' ? 'page' : undefined} onClick={() => setView('sort')}>
          Sort holding playlist
          <small>{holdingName ? `From ${holdingName}` : 'Choose a playlist'}</small>
        </button>
        <button
          className={view === 'outliers' ? 'on' : ''}
          aria-current={view === 'outliers' ? 'page' : undefined}
          onClick={() => setView('outliers')}
        >
          Outliers
          <small>
            {done
              ? `${total} across ${withSuggestions.length} ${withSuggestions.length === 1 ? 'playlist' : 'playlists'}`
              : 'Needs a scan'}
          </small>
        </button>
        <p className="studio-scanned">
          {scanLine}
          <br />
          {busy ? (
            <button className="link" onClick={stopScan}>
              Stop
            </button>
          ) : (
            <button className="link" onClick={() => void scan(playlists)} disabled={playlists.length === 0}>
              {done ? 'Scan again' : `Scan ${playlists.length} playlists`}
            </button>
          )}
        </p>
        <p className="hint subtle studio-about">
          Scan reads your tagged playlists. Sound comes from ReccoBeats, which knows about two thirds of tracks.
        </p>
      </nav>

      <div className="studio-main">
        {state.phase === 'error' && <p className="error">{state.message}</p>}
        {needsLogin && (
          <p className="removal warn" role="status">
            Spotify hasn’t allowed this app to change your playlists yet. Log in again once to allow it.{' '}
            <button onClick={() => void startLogin()}>Log in again</button>
          </p>
        )}
        {done?.failed.length ? <p className="error">Couldn’t read: {done.failed.join('; ')}</p> : null}
        {!done ? (
          <p className="state">{busy ? 'Scanning your playlists…' : 'Scan your playlists to start.'}</p>
        ) : view === 'sort' ? (
          <>
            <Sorter
              mine={mine}
              holdingId={holdingId}
              onHoldingChange={setHoldingId}
              scanned={done.inputs}
              scannedFeatures={done.features}
              onPlayAt={onPlayAt}
            />
            <Accuracy key={done.at} run={() => evaluate(done.inputs, done.features)} />
          </>
        ) : (
          <>
            <h2>Outliers</h2>
            <p className="hint subtle">
              Tracks that sound unlike the rest of their playlist, judged on energy, mood, tempo, loudness and vocals. Suggestions only:
              give each a listen, then remove it or keep it.
            </p>
            <p className="studio-summary">
              <span>
                <strong>{total}</strong> {total === 1 ? 'suggestion' : 'suggestions'} in {withSuggestions.length}{' '}
                {withSuggestions.length === 1 ? 'playlist' : 'playlists'}.
                {done.tooShort > 0 && (
                  <span className="subtle">
                    {' '}
                    {done.tooShort} playlists have fewer than {MIN_FOR_OUTLIERS} tracks with features, so aren’t judged.
                  </span>
                )}
              </span>
              {keptCount > 0 && (
                <label className="studio-kept">
                  <input type="checkbox" checked={showKept} onChange={(e) => setShowKept(e.target.checked)} /> Show {keptCount} kept
                </label>
              )}
            </p>
          {withSuggestions.map((p) => {
            const playlist = byId.get(p.id);
            return (
              <div key={p.id} className="studio-playlist">
                <h3>
                  {p.name} <span className="subtle">· {p.tracks} tracks</span>
                </h3>
                <ul>
                  {visible(p).map((o) => {
                    const key = keyOf(p.id, o.track.id);
                    const row = rows[key];
                    const isKept = keptSet.has(key);
                    const playing = playingId === o.track.id && playingIn === p.id;
                    return (
                      <li key={key} className={`outlier${row?.phase === 'removed' ? ' removed' : ''}`}>
                        <span className="outlier-track">
                          {playing && <span className="badge playing">Playing</span>} {o.track.name}{' '}
                          <span className="subtle">— {o.track.artists}</span>
                          <span className="outlier-why">{why(o)}</span>
                        </span>
                        <span className="outlier-actions">
                          {row?.phase === 'removed' ? (
                            <>
                              <span className="subtle">Removed</span>
                              <button onClick={() => undo(p, o, row.positions)}>Undo</button>
                            </>
                          ) : row?.phase === 'removing' || row?.phase === 'restoring' ? (
                            <span className="subtle">{row.phase === 'removing' ? 'Removing…' : 'Putting back…'}</span>
                          ) : (
                            <>
                              {row?.phase === 'failed' && <span className="error">{row.error}</span>}
                              {row?.phase === 'failed' && row.positions !== undefined ? (
                                <button onClick={() => undo(p, o, row.positions!)}>Try again</button>
                              ) : (
                                <>
                                  <button onClick={() => playlist && onPlayAt(playlist, o.track.id)} disabled={!playlist}>
                                    <span aria-hidden>▶</span> Play
                                  </button>
                                  <button className="danger-outline" onClick={() => remove(p, o)}>
                                    Remove
                                  </button>
                                  {isKept ? (
                                    <button className="quiet" onClick={() => unkeep(key)} title="Suggest it again">
                                      Unkeep
                                    </button>
                                  ) : (
                                    <button className="quiet" onClick={() => keep(key)} title="It fits: stop suggesting it">
                                      Keep
                                    </button>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          </>
        )}
      </div>
    </section>
  );
}

const ago = (at: number) => {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? 'just now' : min === 1 ? '1 min ago' : `${min} min ago`;
};

/**
 * How good playlist suggestions would be (US-5-3), measured on this library: each track is
 * treated as new, and we check whether one of its own playlists comes out on top.
 */
function Accuracy({ run }: { run: () => EvalRow[] }) {
  const [rows, setRows] = useState<EvalRow[] | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const pct = (n: number, of: number) => `${Math.round((100 * n) / (of || 1))}%`;
  const text = (rs: EvalRow[]) =>
    [`Suggestion accuracy (${rs[0]?.tracks ?? 0} tracks, each treated as new)`, 'method | top 1 | top 3 | top 5']
      .concat(rs.map((r) => `${r.label} | ${pct(r.hit1, r.tracks)} | ${pct(r.hit3, r.tracks)} | ${pct(r.hit5, r.tracks)}`))
      .join('\n');
  return (
    <details className="studio-accuracy">
      <summary>How good would playlist suggestions be?</summary>
      <p className="hint subtle">
        For sorting a holding playlist. Each of your tracks is treated as new, and we check how often one of the playlists it’s really in
        comes out first, or in the top 3 or 5.
      </p>
      {!rows ? (
        <button
          onClick={() => {
            setWorking(true);
            setTimeout(() => {
              setRows(run());
              setWorking(false);
            }, 30); // let “Measuring…” show first
          }}
          disabled={working}
        >
          {working ? 'Measuring…' : 'Measure'}
        </button>
      ) : (
        <>
          <table className="studio-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Top 1</th>
                <th>Top 3</th>
                <th>Top 5</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{pct(r.hit1, r.tracks)}</td>
                  <td>{pct(r.hit3, r.tracks)}</td>
                  <td>{pct(r.hit5, r.tracks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => void navigator.clipboard.writeText(text(rows)).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy results'}</button>
        </>
      )}
    </details>
  );
}

const LABELS: Record<string, string> = { instrumentalness: 'instrumental', acousticness: 'acoustic' };
const fmt = (feature: string, v: number) => (feature === 'tempo' ? v.toFixed(0) : feature === 'loudness' ? `${v.toFixed(1)} dB` : v.toFixed(2));

/** `tempo 176 (playlist 111), energy 0.92 (playlist 0.15)` */
function why(o: Outlier): string {
  return o.reasons.map((r) => `${LABELS[r.feature] ?? r.feature} ${fmt(r.feature, r.value)} (playlist ${fmt(r.feature, r.typical)})`).join(', ');
}

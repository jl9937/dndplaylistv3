import { useState } from 'react';
import { startLogin } from '../auth/auth';
import { loadLibrary } from '../library/libraryStore';
import type { NowPlaying } from '../playback/nowPlaying';
import { canWritePlaylists, removeTrack, restoreTrack, type RemoveTarget } from '../playback/skipRemove';
import type { Playlist } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';
import { MIN_FOR_OUTLIERS, type Outlier, type PlaylistCoverage } from '../studio/coverage';
import { scan, stopScan } from '../studio/outlierScan';
import { evaluate, type EvalRow } from '../studio/recommend';
import { useOutlierScan, usePref } from './hooks';

// The Studio tab (Milestone 5). For now, outlier review (US-5-2): suggestions to listen to,
// then remove or keep. Nothing is removed without a click, and removing can be undone.

type Row =
  | { phase: 'removing' | 'restoring' }
  | { phase: 'removed'; position: number }
  | { phase: 'failed'; error: string; position?: number };

const keyOf = (playlistId: string, trackId: string) => `${playlistId}:${trackId}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Studio({
  playlists,
  byId,
  now,
  onPlayAt,
}: {
  /** The playlists to scan: my own tagged ones. */
  playlists: Playlist[];
  byId: Map<string, Playlist>;
  now: NowPlaying;
  /** Play a playlist from a track. Called inside the click. */
  onPlayAt: (p: Playlist, position: number) => void;
}) {
  const state = useOutlierScan();
  const [kept, setKept] = usePref<string[]>('prefs.outliersKept', []);
  const [showKept, setShowKept] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [needsLogin, setNeedsLogin] = useState(false);
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

  function remove(p: PlaylistCoverage, o: Outlier) {
    if (!canWritePlaylists()) return setNeedsLogin(true);
    const key = keyOf(p.id, o.track.id);
    const target: RemoveTarget = { playlistId: p.id, playlistName: p.name, trackId: o.track.id, trackName: o.track.name };
    setRow(key, { phase: 'removing' });
    removeTrack(target).then(
      (position) => {
        setRow(key, { phase: 'removed', position });
        void loadLibrary();
      },
      (e: unknown) => setRow(key, { phase: 'failed', error: message(e) }),
    );
  }

  function undo(p: PlaylistCoverage, o: Outlier, position: number) {
    const key = keyOf(p.id, o.track.id);
    const target: RemoveTarget = { playlistId: p.id, playlistName: p.name, trackId: o.track.id, trackName: o.track.name };
    setRow(key, { phase: 'restoring' });
    restoreTrack(target, position).then(
      () => {
        setRow(key, null);
        void loadLibrary();
      },
      (e: unknown) => setRow(key, { phase: 'failed', error: `Couldn’t put it back: ${message(e)}`, position }),
    );
  }

  const keep = (key: string) => setKept([...kept.filter((k) => k !== key), key]);
  const unkeep = (key: string) => setKept(kept.filter((k) => k !== key));

  const done = state.phase === 'done' ? state : null;
  const visible = (p: PlaylistCoverage) => p.outliers.filter((o) => showKept || !keptSet.has(keyOf(p.id, o.track.id)));
  const withSuggestions = done ? [...done.playlists].filter((p) => visible(p).length > 0).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const total = done ? done.playlists.reduce((a, p) => a + p.outliers.filter((o) => !keptSet.has(keyOf(p.id, o.track.id))).length, 0) : 0;
  const keptCount = done ? done.playlists.reduce((a, p) => a + p.outliers.filter((o) => keptSet.has(keyOf(p.id, o.track.id))).length, 0) : 0;

  return (
    <section className="studio">
      <h2>Outliers</h2>
      <p className="hint subtle">
        Tracks that sound unlike the rest of their playlist, judged on energy, mood, tempo, loudness and vocals (from ReccoBeats, which
        knows about two thirds of tracks). Suggestions only: give each a listen, then remove it or keep it.
      </p>
      <div className="studio-actions">
        <button className="primary" onClick={() => void scan(playlists)} disabled={busy || playlists.length === 0}>
          {done ? 'Scan again' : `Scan ${playlists.length} playlists`}
        </button>
        {busy && <button onClick={stopScan}>Stop</button>}
        {state.phase === 'tracks' && (
          <span>
            Reading playlists… {state.done} / {state.of}
          </span>
        )}
        {state.phase === 'features' && (
          <span>
            Looking up new tracks… {state.done} / {state.of}
          </span>
        )}
        {done && keptCount > 0 && (
          <label className="studio-kept">
            <input type="checkbox" checked={showKept} onChange={(e) => setShowKept(e.target.checked)} /> Show {keptCount} kept
          </label>
        )}
      </div>
      {state.phase === 'error' && <p className="error">{state.message}</p>}
      {needsLogin && (
        <p className="removal warn" role="status">
          Spotify hasn’t allowed this app to change your playlists yet. Log in again once to allow it.{' '}
          <button onClick={() => void startLogin()}>Log in again</button>
        </p>
      )}
      {done && (
        <>
          <p>
            <strong>{total}</strong> {total === 1 ? 'suggestion' : 'suggestions'} in {withSuggestions.length}{' '}
            {withSuggestions.length === 1 ? 'playlist' : 'playlists'}.
            {done.tooShort > 0 && (
              <span className="subtle">
                {' '}
                {done.tooShort} playlists have fewer than {MIN_FOR_OUTLIERS} tracks with features, so aren’t judged.
              </span>
            )}
          </p>
          {done.failed.length > 0 && <p className="error">Couldn’t read: {done.failed.join('; ')}</p>}
          <Accuracy key={done.at} run={() => evaluate(done.inputs, done.features)} />
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
                              <button onClick={() => undo(p, o, row.position)}>Undo</button>
                            </>
                          ) : row?.phase === 'removing' || row?.phase === 'restoring' ? (
                            <span className="subtle">{row.phase === 'removing' ? 'Removing…' : 'Putting back…'}</span>
                          ) : (
                            <>
                              {row?.phase === 'failed' && <span className="error">{row.error}</span>}
                              {row?.phase === 'failed' && row.position !== undefined ? (
                                <button onClick={() => undo(p, o, row.position!)}>Try again</button>
                              ) : (
                                <>
                                  <button onClick={() => playlist && onPlayAt(playlist, o.track.position)} disabled={!playlist}>
                                    Play
                                  </button>
                                  <button onClick={() => remove(p, o)}>Remove</button>
                                  {isKept ? (
                                    <button onClick={() => unkeep(key)} title="Suggest it again">
                                      Unkeep
                                    </button>
                                  ) : (
                                    <button onClick={() => keep(key)} title="It fits: stop suggesting it">
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
    </section>
  );
}

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

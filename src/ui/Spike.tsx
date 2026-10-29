import { useMemo, useRef, useState } from 'react';
import { isListed } from '../library/tags';
import { getPlaylistTracks } from '../spotify/api';
import type { Playlist } from '../spotify/types';
import { MIN_FOR_OUTLIERS, summarise, type CoverageReport, type Outlier, type PlaylistInput } from '../studio/coverage';
import { fetchFeatures } from '../studio/reccobeats';

// The Milestone 5 spike (research.md §7.2), at #/spike, not in the nav. Read-only: it reads
// my tagged playlists' tracks and asks ReccoBeats for their features, then reports coverage
// and whether the features tell the playlists apart.

type Phase =
  | { at: 'idle' }
  | { at: 'spotify'; done: number; of: number }
  | { at: 'features'; done: number; of: number }
  | { at: 'done'; report: CoverageReport; failed: string[] }
  | { at: 'error'; message: string };

const pct = (n: number, of: number) => (of === 0 ? '–' : `${Math.round((100 * n) / of)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (v: number | undefined, digits = 2) => (v === undefined ? '–' : v.toFixed(digits));

export function Spike({ playlists, myId }: { playlists: Playlist[]; myId: string }) {
  const listed = useMemo(() => playlists.filter((p) => isListed(p.name, false)), [playlists]);
  const mine = listed.filter((p) => p.owner.id === myId);
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const busy = phase.at === 'spotify' || phase.at === 'features';

  async function run() {
    const ac = new AbortController();
    abort.current = ac;
    setCopied(false);
    const inputs: PlaylistInput[] = [];
    const failed: string[] = [];
    try {
      for (const [i, p] of mine.entries()) {
        setPhase({ at: 'spotify', done: i, of: mine.length });
        try {
          inputs.push({ id: p.id, name: p.name, tracks: await getPlaylistTracks(p.id, { signal: ac.signal }) });
        } catch (e) {
          if (ac.signal.aborted) throw e;
          failed.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const ids = [...new Set(inputs.flatMap((p) => p.tracks.map((t) => t.id)))];
      setPhase({ at: 'features', done: 0, of: ids.length });
      const features = await fetchFeatures(ids, {
        signal: ac.signal,
        onProgress: (done) => setPhase({ at: 'features', done, of: ids.length }),
      });
      setPhase({ at: 'done', report: summarise(inputs, features), failed });
    } catch (e) {
      setPhase(ac.signal.aborted ? { at: 'idle' } : { at: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <section className="spike">
      <h2>Milestone 5 spike: audio features</h2>
      <p className="hint subtle">
        Reads the tracks of your {plural(mine.length, 'tagged playlist')} and looks each one up in ReccoBeats. Nothing is changed in Spotify.
        {listed.length > mine.length &&
          ` Skipping ${plural(listed.length - mine.length, 'tagged playlist')} you don’t own: Spotify only lists tracks from your own.`}
      </p>
      <div className="spike-actions">
        <button className="primary" onClick={run} disabled={busy || mine.length === 0}>
          {phase.at === 'done' ? 'Run again' : 'Run the check'}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>Stop</button>}
        {phase.at === 'spotify' && (
          <span>
            Reading playlists from Spotify… {phase.done} / {phase.of}
          </span>
        )}
        {phase.at === 'features' && (
          <span>
            Looking up features… {phase.done} / {phase.of} tracks
          </span>
        )}
        {phase.at === 'done' && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(reportText(phase.report, phase.failed)).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
      </div>
      {phase.at === 'error' && <p className="error">{phase.message}</p>}
      {phase.at === 'done' && <Results report={phase.report} failed={phase.failed} />}
    </section>
  );
}

function Results({ report, failed }: { report: CoverageReport; failed: string[] }) {
  const rows = [...report.playlists].sort((a, b) => a.found / (a.tracks || 1) - b.found / (b.tracks || 1));
  const judged = report.playlists.filter((p) => p.found >= 2);
  const own = judged.reduce((a, p) => a + p.nearestOwn, 0);
  const of = judged.reduce((a, p) => a + p.found, 0);
  return (
    <>
      <p className="spike-headline">
        ReccoBeats knows <strong>{pct(report.uniqueFound, report.uniqueTracks)}</strong> of your tracks ({report.uniqueFound} of{' '}
        {report.uniqueTracks}).
        {of > 0 && (
          <>
            {' '}
            Of those, <strong>{pct(own, of)}</strong> sit closest to their own playlist.
          </>
        )}
      </p>
      {failed.length > 0 && (
        <p className="error">
          Couldn’t read {plural(failed.length, 'playlist')}: {failed.join('; ')}
        </p>
      )}
      <div className="spike-table-wrap">
        <table className="spike-table">
          <thead>
            <tr>
              <th>Playlist</th>
              <th>Tracks</th>
              <th>Found</th>
              <th title="Of the found tracks, how many are closest to this playlist's centre">Closest to own</th>
              <th>Tempo</th>
              <th>Energy</th>
              <th>Valence</th>
              <th>Instrumental</th>
              <th>Outliers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.tracks}</td>
                <td>{pct(p.found, p.tracks)}</td>
                <td>{p.found >= 2 ? pct(p.nearestOwn, p.found) : '–'}</td>
                <td>{num(p.median.tempo, 0)}</td>
                <td>{num(p.median.energy)}</td>
                <td>{num(p.median.valence)}</td>
                <td>{num(p.median.instrumentalness)}</td>
                <td>{p.outliers.length || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Outliers ({report.playlists.reduce((a, p) => a + p.outliers.length, 0)})</summary>
        <p className="hint subtle">
          Tracks much further from their playlist’s centre than its other tracks, with the two features that differ most. Playlists
          with fewer than {MIN_FOR_OUTLIERS} found tracks are skipped.
        </p>
        {report.playlists
          .filter((p) => p.outliers.length > 0)
          .map((p) => (
            <div key={p.id} className="spike-list">
              <h3>{p.name}</h3>
              <ul>
                {p.outliers.map((o) => (
                  <li key={o.track.id}>
                    {o.track.name} <span className="subtle">— {o.track.artists}</span> · {why(o)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </details>
      <details>
        <summary>Tracks ReccoBeats doesn’t know ({report.missing.length})</summary>
        <ul className="spike-list">
          {report.missing.map((t) => (
            <li key={t.id}>
              {t.name} <span className="subtle">— {t.artists}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** `energy 0.92 (playlist 0.15), tempo 160 (playlist 104)` */
function why(o: Outlier): string {
  return o.reasons.map((r) => `${r.feature} ${fmt(r.feature, r.value)} (playlist ${fmt(r.feature, r.typical)})`).join(', ');
}
const fmt = (feature: string, v: number) => (feature === 'tempo' ? v.toFixed(0) : feature === 'loudness' ? `${v.toFixed(1)} dB` : v.toFixed(2));

/** Plain text to paste back into the chat. */
function reportText(r: CoverageReport, failed: string[]): string {
  const lines = [
    `Spike report: ReccoBeats knows ${r.uniqueFound} of ${r.uniqueTracks} tracks (${pct(r.uniqueFound, r.uniqueTracks)})`,
    '',
    'playlist | tracks | found | closest-to-own | tempo | energy | valence | instrumental | acoustic | outliers',
    ...r.playlists.map((p) =>
      [
        p.name,
        p.tracks,
        p.found,
        p.found >= 2 ? p.nearestOwn : '-',
        num(p.median.tempo, 0),
        num(p.median.energy),
        num(p.median.valence),
        num(p.median.instrumentalness),
        num(p.median.acousticness),
        p.outliers.map((o) => `${o.track.name} (${o.track.artists}) [${why(o)}]`).join('; ') || '-',
      ].join(' | '),
    ),
    '',
    `Missing (${r.missing.length}): ${r.missing.map((t) => `${t.name} (${t.artists})`).join('; ')}`,
  ];
  if (failed.length) lines.push('', `Failed: ${failed.join('; ')}`);
  return lines.join('\n');
}

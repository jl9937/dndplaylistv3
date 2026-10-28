import { useState } from 'react';
import type { PlayerDevice } from '../playback/device';
import type { DevicePref } from '../playback/devices';
import { pipeline } from '../playback/pipeline';
import { initialSteps, runReadyCheck, type ReadyStep } from '../playback/readyCheck';
import { trackCount, type Playlist } from '../spotify/types';
import { read, write } from '../storage';

const TEST_PLAYLIST_KEY = 'prefs.readyCheckPlaylist';

export function ReadyCheck({
  playlists,
  pref,
  makeDevice,
  onClose,
}: {
  playlists: Playlist[];
  pref: DevicePref | null;
  /** The device for the chosen pref, with no fallback: the check reports on what you chose. */
  makeDevice: (pref: DevicePref) => PlayerDevice | null;
  onClose: () => void;
}) {
  const remembered = read<string>(TEST_PLAYLIST_KEY) ?? read<string>('prefs.lastPlaylist');
  const [testId, setTestId] = useState<string>(
    playlists.find((p) => p.id === remembered)?.id ?? playlists[0]?.id ?? '',
  );
  const [steps, setSteps] = useState<ReadyStep[]>(initialSteps());
  const [running, setRunning] = useState(false);
  const [autoplayOff, setAutoplayOff] = useState(false);

  const run = async () => {
    const p = playlists.find((x) => x.id === testId) ?? null;
    if (p) write(TEST_PLAYLIST_KEY, p.id);
    setRunning(true);
    try {
      await runReadyCheck({
        pref,
        playlist: p && { id: p.id, name: p.name, total: trackCount(p) },
        pipeline,
        makeDevice: (d) => makeDevice(d)!,
        onUpdate: setSteps,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="ready-check" aria-label="Ready check">
      <header>
        <h2>Ready check</h2>
        <button onClick={onClose} aria-label="Close ready check">×</button>
      </header>
      <label>
        Test playlist{' '}
        <select value={testId} onChange={(e) => setTestId(e.target.value)} disabled={running}>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint subtle">It plays for a few seconds on your chosen device, then pauses.</p>
      <button className="primary" onClick={run} disabled={running}>
        {running ? 'Checking…' : 'Run ready check'}
      </button>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.key} className={s.status}>
            <span className="dot" aria-hidden />
            <span>{s.label}</span>
            {s.detail && <span className="detail">{s.detail}</span>}
          </li>
        ))}
        <li className={autoplayOff ? 'ok' : 'pending'}>
          <label>
            <input type="checkbox" checked={autoplayOff} onChange={(e) => setAutoplayOff(e.target.checked)} /> Autoplay is
            off in the Spotify app (Settings → Autoplay)
          </label>
        </li>
      </ol>
    </section>
  );
}

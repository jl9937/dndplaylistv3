import type { PressState } from '../playback/pipeline';

export function PlayerBar({
  press,
  playlistName,
  canControl,
  onPause,
  onResume,
}: {
  press: PressState;
  playlistName: string | null;
  canControl: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const what = playlistName ?? 'Spotify';
  let text = 'Nothing started from here yet.';
  if (press.status === 'starting') text = `${what}: ${press.step}`;
  if (press.status === 'playing') text = `Playing ${what} on ${press.deviceLabel}`;
  if (press.status === 'paused') text = `Paused on ${press.deviceLabel}`;
  if (press.status === 'failed') text = `Failed: ${press.reason}`;

  return (
    <section className={`player-bar ${press.status}`} aria-live="polite">
      <span className="now">{text}</span>
      <span className="controls">
        <button onClick={onPause} disabled={!canControl}>Pause</button>
        <button onClick={onResume} disabled={!canControl}>Resume</button>
      </span>
    </section>
  );
}

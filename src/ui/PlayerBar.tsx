import { describePlaylist } from '../library/tags';
import type { NowPlaying } from '../playback/nowPlaying';
import type { PressState } from '../playback/pipeline';
import { pickCover, type Playlist } from '../spotify/types';
import { parsePlaylistId } from '../spotify/uri';
import { Cover } from './Cover';

export function PlayerBar({
  press,
  now,
  byId,
  canControl,
  onToggle,
  onNext,
  docked = false,
  fade,
  skipRemove,
}: {
  press: PressState;
  now: NowPlaying;
  byId: Map<string, Playlist>;
  canControl: boolean;
  onToggle: () => void;
  onNext: () => void;
  /** The main window's bottom bar: larger, with the track's album art. */
  docked?: boolean;
  /** The soft-transition toggle, shown in the docked bar. */
  fade?: { on: boolean; toggle: () => void };
  /** Skip and remove (D31), shown in the docked bar. */
  skipRemove?: { onClick: () => void; disabled: boolean; title: string };
}) {
  const pressedName = press.status !== 'idle' && press.playlistId ? byId.get(press.playlistId)?.name : undefined;
  const short = (name: string | undefined) => (name ? describePlaylist(name).shortName : 'Spotify');

  let line: string;
  let sub: string | null = null;
  let tone: string = press.status;
  const st = now.state;

  if (press.status === 'starting') {
    line = `${short(pressedName)}: ${press.step}`;
  } else if (press.status === 'failed') {
    line = `Failed: ${press.reason}`;
  } else if (st === undefined) {
    line = 'Checking what Spotify is playing…';
  } else if (st === null) {
    line = 'Nothing is playing in Spotify.';
    tone = 'idle';
  } else {
    const track = st.item?.name ?? 'Unknown track';
    const artists = st.item?.artists?.map((a) => a.name).join(', ');
    line = artists ? `${track} — ${artists}` : track;
    const ctxId = parsePlaylistId(st.context?.uri);
    const ctxName = ctxId ? byId.get(ctxId)?.name : undefined;
    const ours = press.status !== 'idle' && press.playlistId && ctxId === press.playlistId;
    const where = st.device?.name ? ` on ${st.device.name}` : '';
    if (ctxName) sub = `${short(ctxName)}${where}`;
    else if (ctxId) sub = `Another playlist${where}`;
    else sub = `Not a playlist${where}`;
    if ((press.status === 'playing' || press.status === 'paused') && !ours) {
      sub += ' · started outside this app';
    }
    tone = st.is_playing ? 'playing' : 'paused';
    if (!st.is_playing) sub += ' · paused';
  }

  const isPlaying = !!now.state?.is_playing;
  // The playing track's album art, or none: not the playlist's cover (Jim, 2026-10-29).
  const art = now.state?.item?.album?.images;
  return (
    <section className={`player-bar ${tone}${docked ? ' docked' : ''}`} aria-live="polite">
      {docked && pickCover(art) && <Cover images={art} className="now-cover" />}
      <span className="now">
        <span className="now-line">{line}</span>
        {sub && <span className="now-sub">{sub}</span>}
      </span>
      <span className="controls">
        {fade && (
          <button
            className={`pill${fade.on ? ' on' : ''}`}
            aria-pressed={fade.on}
            onClick={fade.toggle}
            title="Fade the music out before switching playlist"
          >
            {fade.on ? '✓ Fade' : 'Fade off'}
          </button>
        )}
        <button className={docked ? 'primary' : undefined} onClick={onToggle} disabled={!canControl}>
          {isPlaying ? 'Pause' : 'Resume'}
        </button>
        <button onClick={onNext} disabled={!canControl || !now.state}>
          Next
        </button>
        {skipRemove && (
          <button onClick={skipRemove.onClick} disabled={!canControl || skipRemove.disabled} title={skipRemove.title}>
            Skip &amp; remove
          </button>
        )}
      </span>
    </section>
  );
}

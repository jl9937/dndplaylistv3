import { useEffect, useRef, useState } from 'react';
import { startLogin } from '../auth/auth';
import { log } from '../diagnostics/log';
import { loadLibrary } from '../library/libraryStore';
import { describePlaylist } from '../library/tags';
import type { NowPlaying } from '../playback/nowPlaying';
import { canWritePlaylists, removeTarget, removeTrack, restoreTrack, stillPlaying, type RemoveTarget } from '../playback/skipRemove';
import { getPlaybackState } from '../spotify/api';
import type { Playlist } from '../spotify/types';

type Removal =
  | { phase: 'needs-login' }
  | { phase: 'removing' | 'failed-remove'; target: RemoveTarget; error?: string }
  | { phase: 'removed' | 'restoring' | 'restored' | 'failed-restore' | 'changed'; target: RemoveTarget; positions: number[]; error?: string };

/** How long the Undo line stays after a removal or an undo. */
const SHOW_MS = 20_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Skip and remove (D31 #1): the player bar's button, and the line with Undo above it. */
export function useSkipRemove({ now, byId, myId, next }: { now: NowPlaying; byId: Map<string, Playlist>; myId: string | null; next: () => void }) {
  const [removal, setRemoval] = useState<Removal | null>(null);
  const seq = useRef(0);
  const target = removeTarget(now.state, byId, myId);

  // Hide the line a while after it settles; a newer removal resets the clock.
  useEffect(() => {
    if (removal?.phase !== 'removed' && removal?.phase !== 'restored') return;
    const t = setTimeout(() => setRemoval(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [removal]);

  async function skipAndRemove() {
    if ('reason' in target) return;
    if (!canWritePlaylists()) return setRemoval({ phase: 'needs-login' });
    const mine = ++seq.current;
    const update = (r: Removal) => mine === seq.current && setRemoval(r);
    update({ phase: 'removing', target });
    // "Now playing" can be up to 5 s old: check it's still this track, or the wrong one goes.
    let fresh: Awaited<ReturnType<typeof getPlaybackState>>;
    try {
      fresh = await getPlaybackState({ signal: AbortSignal.timeout(4000) });
    } catch (e: unknown) {
      return update({ phase: 'failed-remove', target, error: message(e) });
    }
    if (!stillPlaying(target, fresh)) {
      log('app', 'skip and remove: the track changed first; nothing removed');
      return update({ phase: 'changed', target, positions: [] });
    }
    next();
    removeTrack(target).then(
      (positions) => {
        log('app', 'skip and remove: removed');
        update({ phase: 'removed', target, positions });
        void loadLibrary(); // the song count, used for the random start (D14)
      },
      (e: unknown) => {
        log('app', `skip and remove failed: ${message(e)}`);
        update({ phase: 'failed-remove', target, error: message(e) });
      },
    );
  }

  function undo() {
    if (removal?.phase !== 'removed' && removal?.phase !== 'failed-restore') return;
    const { target: t, positions } = removal;
    const mine = ++seq.current;
    const update = (r: Removal) => mine === seq.current && setRemoval(r);
    update({ phase: 'restoring', target: t, positions });
    restoreTrack(t, positions).then(
      () => {
        log('app', 'skip and remove: undone');
        update({ phase: 'restored', target: t, positions });
        void loadLibrary();
      },
      (e: unknown) => update({ phase: 'failed-restore', target: t, positions, error: message(e) }),
    );
  }

  return {
    button: {
      onClick: () => void skipAndRemove(),
      disabled: 'reason' in target,
      title: 'reason' in target ? target.reason : `Skip this track and remove it from ${describePlaylist(target.playlistName).shortName}`,
    },
    notice: removal && <RemovalLine removal={removal} onUndo={undo} onDismiss={() => setRemoval(null)} />,
  };
}

function RemovalLine({ removal, onUndo, onDismiss }: { removal: Removal; onUndo: () => void; onDismiss: () => void }) {
  const dismiss = (
    <button className="icon" onClick={onDismiss} aria-label="Dismiss">
      ×
    </button>
  );
  if (removal.phase === 'needs-login') {
    return (
      <p className="removal warn" role="status">
        Spotify hasn’t allowed this app to change your playlists yet. Log in again once to allow it.{' '}
        <button onClick={() => void startLogin()}>Log in again</button> {dismiss}
      </p>
    );
  }
  const track = `“${removal.target.trackName}”`;
  const from = describePlaylist(removal.target.playlistName).shortName;
  switch (removal.phase) {
    case 'changed':
      return (
        <p className="removal" role="status">
          The track changed just before you pressed, so nothing was removed. {dismiss}
        </p>
      );
    case 'removing':
      return <p className="removal" role="status">Removing {track} from {from}…</p>;
    case 'removed':
      return (
        <p className="removal" role="status">
          Removed {track} from {from}. <button onClick={onUndo}>Undo</button> {dismiss}
        </p>
      );
    case 'restoring':
      return <p className="removal" role="status">Putting {track} back…</p>;
    case 'restored':
      return (
        <p className="removal" role="status">
          Put {track} back in {from}. {dismiss}
        </p>
      );
    case 'failed-remove':
      return (
        <p className="removal bad" role="alert">
          Couldn’t remove {track}: {removal.error} {dismiss}
        </p>
      );
    case 'failed-restore':
      return (
        <p className="removal bad" role="alert">
          Couldn’t put {track} back: {removal.error} <button onClick={onUndo}>Try again</button> {dismiss}
        </p>
      );
  }
}

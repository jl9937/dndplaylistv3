import { useEffect, useState } from 'react';
import { startLogin } from '../auth/auth';
import { log } from '../diagnostics/log';
import { renameLocally } from '../library/libraryStore';
import { addTagToName, describePlaylist, markerTags, removeTagFromName, tagKey } from '../library/tags';
import { canWritePlaylists } from '../playback/skipRemove';
import { renamePlaylist } from '../spotify/api';
import type { Playlist } from '../spotify/types';

// Tag a playlist (D31 #4): add one of the existing tags as a `[Tag]` marker, or take a marker
// off again. The playlist is renamed in Spotify; Undo renames it back.

type Rename =
  | { phase: 'needs-login' }
  | { phase: 'saving' | 'done' | 'undone'; playlistId: string; from: string; to: string }
  | { phase: 'failed'; playlistId: string; from: string; to: string; error: string };

const SHOW_MS = 20_000;

export function useRename() {
  const [rename, setRename] = useState<Rename | null>(null);
  useEffect(() => {
    if (rename?.phase !== 'done' && rename?.phase !== 'undone') return;
    const t = setTimeout(() => setRename(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [rename]);

  async function apply(playlistId: string, from: string, to: string, undo = false): Promise<boolean> {
    if (!canWritePlaylists()) {
      setRename({ phase: 'needs-login' });
      return false;
    }
    setRename({ phase: 'saving', playlistId, from, to });
    try {
      await renamePlaylist(playlistId, to);
      renameLocally(playlistId, to);
      log('app', undo ? 'tag: undone' : 'tag: playlist renamed');
      setRename({ phase: undo ? 'undone' : 'done', playlistId, from, to });
      return true;
    } catch (e) {
      setRename({ phase: 'failed', playlistId, from, to, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  const line = rename && (
    <RenameLine
      rename={rename}
      onUndo={() => rename.phase === 'done' && void apply(rename.playlistId, rename.to, rename.from, true)}
      onRetry={() => rename.phase === 'failed' && void apply(rename.playlistId, rename.from, rename.to)}
      onDismiss={() => setRename(null)}
    />
  );
  return { apply, line, saving: rename?.phase === 'saving' };
}

function RenameLine({ rename, onUndo, onRetry, onDismiss }: { rename: Rename; onUndo: () => void; onRetry: () => void; onDismiss: () => void }) {
  const dismiss = (
    <button className="icon" onClick={onDismiss} aria-label="Dismiss">
      ×
    </button>
  );
  if (rename.phase === 'needs-login') {
    return (
      <p className="notice warn" role="status">
        Spotify hasn’t allowed this app to change your playlists yet. Log in again once to allow it.{' '}
        <button onClick={() => void startLogin()}>Log in again</button> {dismiss}
      </p>
    );
  }
  const to = `“${rename.to}”`;
  switch (rename.phase) {
    case 'saving':
      return (
        <p className="notice" role="status">
          Renaming to {to}…
        </p>
      );
    case 'done':
      return (
        <p className="notice" role="status">
          Renamed “{rename.from}” to {to} in Spotify. <button onClick={onUndo}>Undo</button> {dismiss}
        </p>
      );
    case 'undone':
      return (
        <p className="notice" role="status">
          Renamed back to {to}. {dismiss}
        </p>
      );
    case 'failed':
      return (
        <p className="notice bad" role="alert">
          Couldn’t rename to {to}: {rename.error} <button onClick={onRetry}>Try again</button> {dismiss}
        </p>
      );
  }
}

/** The picker under a Library card: + for each tag it doesn't have, × for each `[Tag]` it does. */
export function TagPicker({
  playlist,
  allTags,
  busy,
  onRename,
}: {
  playlist: Playlist;
  /** Every tag in the library, in its usual spelling, A–Z. */
  allTags: string[];
  busy: boolean;
  onRename: (to: string) => void;
}) {
  const has = describePlaylist(playlist.name).tags.map(tagKey);
  const addable = allTags.filter((t) => !has.includes(tagKey(t)));
  const markers = markerTags(playlist.name);
  return (
    <div className="tag-picker" role="group" aria-label={`Tags for ${describePlaylist(playlist.name).shortName}`}>
      {markers.map((t) => (
        <button key={`x-${t}`} className="pill on" disabled={busy} onClick={() => onRename(removeTagFromName(playlist.name, t))} title={`Remove [${t}] from the name`}>
          × {t}
        </button>
      ))}
      {addable.map((t) => (
        <button key={t} className="pill" disabled={busy} onClick={() => onRename(addTagToName(playlist.name, t))} title={`Add [${t}] to the name`}>
          + {t}
        </button>
      ))}
      <span className="hint subtle">Renames it in Spotify: “{playlist.name}”</span>
    </div>
  );
}

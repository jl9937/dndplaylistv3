import { useEffect, useMemo, useRef, useState } from 'react';
import { daysUntilRelogin, logout, type CallbackResult } from './auth/auth';
import { RELOGIN_WARN_DAYS } from './config';
import { loadLibrary, resetLibrary } from './library/libraryStore';
import { deviceStore, loadDevicePref, saveDevicePref, type DevicePref } from './playback/devices';
import { displayStatus, refreshNowPlaying, startNowPlaying } from './playback/nowPlaying';
import { createRemoteDevice, pipeline } from './playback/pipeline';
import { boardOrder, currentSet, hasPlaylist, moveScene, moveSection, removeScene, syncNames, togglePlaylist } from './sets/sets';
import { updateSets } from './sets/setsStore';
import { parsePlaylistName } from './library/tags';
import { trackCount, type Playlist } from './spotify/types';
import { read, write } from './storage';
import { Board } from './ui/Board';
import { DebugPanel } from './ui/DebugPanel';
import { DevicePicker } from './ui/DevicePicker';
import { useAuthStatus, useLibrary, useNowPlaying, usePressState, useSets } from './ui/hooks';
import { Library } from './ui/Library';
import { LoginScreen } from './ui/LoginScreen';
import { Palette } from './ui/Palette';
import { PlayerBar } from './ui/PlayerBar';
import { ReadyCheck } from './ui/ReadyCheck';
import { useRoute } from './ui/router';
import { useShortcuts } from './ui/shortcuts';
import { itemStatus } from './ui/Status';

export function App({ callback }: { callback: CallbackResult }) {
  const status = useAuthStatus();
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(location.search).has('debug'));

  return (
    <>
      {status === 'logged-in' ? (
        <Main onShowLog={() => setShowDebug(true)} />
      ) : (
        <LoginScreen
          relogin={status === 'relogin-needed'}
          message={callback.kind === 'error' ? callback.message : undefined}
        />
      )}
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
    </>
  );
}

function Main({ onShowLog }: { onShowLog: () => void }) {
  const library = useLibrary();
  const sets = useSets();
  const press = usePressState();
  const now = useNowPlaying();
  const [pref, setPref] = useState<DevicePref | null>(loadDevicePref);
  const [showReady, setShowReady] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUntagged, setShowUntaggedState] = useState(() => read<boolean>('prefs.showUntagged') ?? false);
  const setShowUntagged = (v: boolean) => {
    write('prefs.showUntagged', v);
    setShowUntaggedState(v);
  };
  const deviceSelect = useRef<HTMLSelectElement>(null);

  const set = currentSet(sets);
  const [route, go] = useRoute(set.scenes.length > 0 ? 'board' : 'library');

  useEffect(() => {
    void loadLibrary();
    return startNowPlaying();
  }, []);

  // Keep cached scene names in step with Spotify (renames, retags).
  useEffect(() => {
    if (library.status !== 'ok') return;
    const names = new Map(library.playlists.map((p) => [p.id, p.name]));
    updateSets((d) => syncNames(d, names));
  }, [library]);

  const device = useMemo(() => (pref ? createRemoteDevice(pref, deviceStore) : null), [pref]);
  const playlists = library.status === 'ok' ? library.playlists : [];
  const visible = showUntagged ? playlists : playlists.filter((p) => parsePlaylistName(p.name).tag !== null);
  const byId = library.status === 'ok' ? library.byId : new Map<string, Playlist>();

  const statusOf = (playlistId: string) => itemStatus(playlistId, press, displayStatus(playlistId, press, now));
  const inSet = (playlistId: string) => hasPlaylist(set, playlistId);
  const toggleSet = (p: Playlist) => updateSets((d) => togglePlaylist(d, p));

  const choosePref = (p: DevicePref) => {
    saveDevicePref(p);
    setPref(p);
    setNotice(null);
  };

  const chooseDevice = () => {
    deviceSelect.current?.scrollIntoView({ block: 'center' });
    deviceSelect.current?.focus();
    void deviceStore.refresh().catch(() => {});
  };

  const play = (p: Playlist) => {
    if (!device) {
      setNotice('Choose where the music plays first.');
      chooseDevice();
      return;
    }
    setNotice(null);
    write('prefs.lastPlaylist', p.id);
    void pipeline.press({ id: p.id, total: trackCount(p) }, device);
  };

  const togglePause = () => {
    if (!device) return;
    void (now.state?.is_playing ? pipeline.pause(device) : pipeline.resume(device));
  };

  const next = async () => {
    if (!device) return;
    const error = await pipeline.next(device);
    setNotice(error);
    setTimeout(() => void refreshNowPlaying(), 600);
  };

  const playTile = (n: number) => {
    const scene = boardOrder(set)[n - 1];
    const p = scene && byId.get(scene.playlistId);
    if (p) play(p);
  };

  useShortcuts(
    { openPalette: () => library.status === 'ok' && setShowPalette(true), playTile },
    !showPalette,
  );

  const onLogout = () => {
    pipeline.reset();
    deviceStore.clear();
    resetLibrary();
    logout();
  };

  const days = daysUntilRelogin();

  return (
    <div className="app">
      <header className="top">
        <h1>D&amp;D Playlist Manager</h1>
        <nav className="tabs" aria-label="Views">
          <a href="#/board" aria-current={route === 'board' ? 'page' : undefined}>
            Board
          </a>
          <a href="#/library" aria-current={route === 'library' ? 'page' : undefined}>
            Library
          </a>
        </nav>
        {days !== null && days <= RELOGIN_WARN_DAYS && <span className="warn">Re-login needed in {days} days</span>}
        <nav className="actions">
          <button onClick={() => setShowPalette(true)} disabled={library.status !== 'ok'} title="Cmd+K or /">
            All playlists <kbd>⌘K</kbd>
          </button>
          <button onClick={() => setShowReady((v) => !v)} disabled={library.status !== 'ok'}>
            Ready check
          </button>
          <button className="link" onClick={onShowLog}>
            Log
          </button>
          <button className="link" onClick={onLogout}>
            Log out
          </button>
        </nav>
      </header>

      <DevicePicker ref={deviceSelect} pref={pref} onChange={choosePref} />
      {notice && <p className="notice">{notice}</p>}

      {showReady && library.status === 'ok' && (
        <ReadyCheck playlists={playlists} pref={pref} onClose={() => setShowReady(false)} />
      )}

      <PlayerBar press={press} now={now} byId={byId} canControl={!!device} onToggle={togglePause} onNext={next} />

      {route === 'board' && library.status === 'ok' ? (
        <Board
          set={set}
          byId={byId}
          statusOf={statusOf}
          onPlay={play}
          onRemove={(id) => updateSets((d) => removeScene(d, id))}
          onMoveScene={(from, to) => updateSets((d) => moveScene(d, from, to))}
          onMoveSection={(key, dir) => updateSets((d) => moveSection(d, key, dir))}
          onOpenLibrary={() => go('library')}
        />
      ) : (
        <Library
          library={library}
          showUntagged={showUntagged}
          onShowUntagged={setShowUntagged}
          statusOf={statusOf}
          inSet={inSet}
          onPlay={play}
          onToggleSet={toggleSet}
          onRetry={loadLibrary}
          onChooseDevice={chooseDevice}
        />
      )}

      {showPalette && (
        <Palette playlists={visible} inSet={inSet} onPlay={play} onToggleSet={toggleSet} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}

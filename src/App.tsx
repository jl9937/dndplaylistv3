import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { daysUntilRelogin, logout, type CallbackResult } from './auth/auth';
import { RELOGIN_WARN_DAYS } from './config';
import { loadLibrary, resetLibrary } from './library/libraryStore';
import { deviceStore, loadDevicePref, saveDevicePref, type DevicePref } from './playback/devices';
import { displayStatus, refreshNowPlaying, setFloating, startNowPlaying } from './playback/nowPlaying';
import { createRemoteDevice, FADE_PREF, pipeline } from './playback/pipeline';
import { boardOrder, currentSet, hasPlaylist, moveScene, moveSection, removeScene, syncNames, togglePlaylist } from './sets/sets';
import { updateSets } from './sets/setsStore';
import { describePlaylist } from './library/tags';
import { trackCount, type Playlist } from './spotify/types';
import { read, write } from './storage';
import { Board } from './ui/Board';
import { DebugPanel } from './ui/DebugPanel';
import { DevicePicker, isBrowserPref } from './ui/DevicePicker';
import { createFallbackDevice } from './playback/fallback';
import { bootPlayer, webPlayback } from './player/instance';
import { createSdkDevice } from './player/sdkDevice';
import { SDK_PLAYER_NAME } from './player/webPlayback';
import { useAuthStatus, useAutoplayBlocked, useLibrary, useNowPlaying, usePressState, useSets } from './ui/hooks';
import { Library } from './ui/Library';
import { LoginScreen } from './ui/LoginScreen';
import { Palette } from './ui/Palette';
import { PlayerBar } from './ui/PlayerBar';
import { ReadyCheck } from './ui/ReadyCheck';
import { useRoute } from './ui/router';
import { useShortcuts } from './ui/shortcuts';
import { canFloat, dockToRight, openFloat, restoreWindow } from './ui/compact';
import { Strip } from './ui/Strip';
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
  const [compact, setCompact] = useState(false);
  const [fadeOn, setFadeOn] = useState(() => read<boolean>(FADE_PREF) ?? true);
  const toggleFade = () => {
    write(FADE_PREF, !fadeOn);
    setFadeOn(!fadeOn);
  };
  const [pip, setPip] = useState<Window | null>(null);

  const set = currentSet(sets);
  const [route, go] = useRoute(set.scenes.length > 0 ? 'board' : 'library');

  const autoplayBlocked = useAutoplayBlocked();

  useEffect(() => {
    void loadLibrary();
    void bootPlayer();
    return startNowPlaying();
  }, []);

  // Keep cached scene names in step with Spotify (renames, retags).
  useEffect(() => {
    if (library.status !== 'ok') return;
    const names = new Map(library.playlists.map((p) => [p.id, p.name]));
    updateSets((d) => syncNames(d, names));
  }, [library]);

  const sdkDevice = useMemo(() => createSdkDevice(webPlayback), []);
  const device = useMemo(
    () => (!pref ? null : isBrowserPref(pref) ? sdkDevice : createRemoteDevice(pref, deviceStore)),
    [pref, sdkDevice],
  );

  /** Per press: a remote choice falls back to this window if it isn't open (US-1b-2). */
  const pressDevice = () => {
    if (!device || device === sdkDevice) return device;
    return createFallbackDevice(
      device,
      sdkDevice,
      () => {
        const s = webPlayback.getStatus();
        return s.state !== 'off' && !(s.state === 'failed' && s.action !== 'reload');
      },
      (label) => setNotice(`Spotify app not found on ${label}, so it's playing in this window.`),
    );
  };

  /** Pause and Next go to whatever is actually playing: this window after a fallback. */
  const controlDevice = () =>
    now.state?.device?.name === SDK_PLAYER_NAME || (now.state?.device?.id && now.state.device.id === sdkId())
      ? sdkDevice
      : device;
  const sdkId = () => {
    const s = webPlayback.getStatus();
    return s.state === 'ready' ? s.deviceId : null;
  };
  const playlists = library.status === 'ok' ? library.playlists : [];
  const visible = playlists.filter((p) => {
    const d = describePlaylist(p.name);
    return !d.hidden && (showUntagged || d.tags.length > 0);
  });
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
    void pipeline.press({ id: p.id, total: trackCount(p) }, pressDevice()!);
  };

  const togglePause = () => {
    const d = controlDevice();
    if (!d) return;
    void (now.state?.is_playing ? pipeline.pause(d) : pipeline.resume(d));
  };

  const next = async () => {
    const d = controlDevice();
    if (!d) return;
    const error = await pipeline.next(d);
    setNotice(error);
    setTimeout(() => void refreshNowPlaying(), 600);
  };

  const playTile = (n: number) => {
    const scene = boardOrder(set)[n - 1];
    const p = scene && byId.get(scene.playlistId);
    if (p) play(p);
  };

  useShortcuts(
    { openPalette: () => library.status === 'ok' && !compact && !pip && setShowPalette(true), playTile },
    !showPalette,
    pip,
  );

  const enterCompact = () => {
    setShowPalette(false);
    setCompact(true);
    dockToRight();
  };
  const exitCompact = () => {
    setCompact(false);
    restoreWindow();
  };

  const float = async () => {
    try {
      const w = await openFloat();
      w.addEventListener('pagehide', () => {
        setPip(null);
        setFloating(false);
      });
      setPip(w);
      setFloating(true);
      if (compact) exitCompact();
    } catch (e) {
      setNotice(`Couldn’t open the floating strip: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Closing the app closes the floating strip too.
  useEffect(() => () => pip?.close(), [pip]);

  const stripProps = { set, byId, press, now, canControl: !!device, statusOf, notice, onPlay: play, onToggle: togglePause, onNext: next };
  const floatButton = canFloat() && !pip && (
    <button onClick={float} title="Always on top, over other windows">
      Float
    </button>
  );
  const floating =
    pip &&
    createPortal(
      <Strip {...stripProps} actions={<button onClick={() => pip.close()}>Back to app</button>} />,
      pip.document.body,
    );

  if (compact) {
    return (
      <>
        <Strip
          {...stripProps}
          actions={
            <>
              {floatButton}
              <button onClick={exitCompact}>Expand</button>
            </>
          }
        />
        {floating}
      </>
    );
  }

  const onLogout = () => {
    webPlayback.stop();
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
          <button onClick={enterCompact} title="Narrow strip for beside Notion">
            Compact
          </button>
          {floatButton}
          <button className="link" onClick={onShowLog}>
            Log
          </button>
          <button className="link" onClick={onLogout}>
            Log out
          </button>
        </nav>
      </header>

      {pip && (
        <p className="notice">
          The strip is floating on top of your other windows.{' '}
          <button onClick={() => pip.focus()}>Show it</button> <button onClick={() => pip.close()}>Close it</button>
        </p>
      )}
      <DevicePicker ref={deviceSelect} pref={pref} onChange={choosePref} />
      {notice && (
        <p className="notice">
          {notice}{' '}
          <button className="icon" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}
      {autoplayBlocked && (
        <button className="primary big enable-audio" onClick={() => void webPlayback.enableAudio()}>
          Click to enable audio
        </button>
      )}

      {showReady && library.status === 'ok' && (
        <ReadyCheck playlists={playlists} pref={pref} onClose={() => setShowReady(false)} />
      )}


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
      <div className="player-dock">
        <PlayerBar docked fade={{ on: fadeOn, toggle: toggleFade }} press={press} now={now} byId={byId} canControl={!!device} onToggle={togglePause} onNext={next} />
      </div>
      {floating}
    </div>
  );
}

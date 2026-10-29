import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { daysUntilRelogin, type CallbackResult } from './auth/auth';
import { ambience } from './ambience/instance';
import { boardOrder, isOnBoard, moveScene, moveSection, removeScene, setSceneAmbience, syncNames, toggleOnBoard, type Scene } from './board/board';
import { updateBoard } from './board/boardStore';
import { RELOGIN_WARN_DAYS } from './config';
import { loadLibrary } from './library/libraryStore';
import { isListed } from './library/tags';
import { logoutEverything } from './logout';
import { deviceStore, loadDevicePref, saveDevicePref, type DevicePref } from './playback/devices';
import { displayStatus, refreshNowPlaying, startNowPlaying } from './playback/nowPlaying';
import { FADE_PREF, pipeline } from './playback/pipeline';
import { createPlayback } from './playback/playback';
import { bootPlayer, webPlayback } from './player/instance';
import { createSdkDevice } from './player/sdkDevice';
import { trackCount, type Playlist } from './spotify/types';
import { write } from './storage';
import { Ambience, AmbienceMini } from './ui/Ambience';
import { Board, type TileAmbience } from './ui/Board';
import { useSkipRemove } from './ui/SkipRemove';
import { Spike } from './ui/Spike';
import { canFloat } from './ui/compact';
import { DebugPanel } from './ui/DebugPanel';
import { DevicePicker } from './ui/DevicePicker';
import { useAmbience, useAuthStatus, useAutoplayBlocked, useBoard, useLibrary, useNowPlaying, usePref, usePressState } from './ui/hooks';
import { Library } from './ui/Library';
import { LoginScreen } from './ui/LoginScreen';
import { Palette } from './ui/Palette';
import { PlayerBar } from './ui/PlayerBar';
import { ReadyCheck } from './ui/ReadyCheck';
import { useRoute } from './ui/router';
import { useShortcuts } from './ui/shortcuts';
import { itemStatus } from './ui/Status';
import { Strip } from './ui/Strip';
import { useStripMode } from './ui/useStripMode';

export function App({ callback }: { callback: CallbackResult }) {
  const status = useAuthStatus();
  const [showDebug, setShowDebug] = useState(() => new URLSearchParams(location.search).has('debug'));

  return (
    <>
      {status === 'logged-in' ? (
        <Main onShowLog={() => setShowDebug(true)} />
      ) : (
        <LoginScreen relogin={status === 'relogin-needed'} message={callback.kind === 'error' ? callback.message : undefined} />
      )}
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
    </>
  );
}

function Main({ onShowLog }: { onShowLog: () => void }) {
  const library = useLibrary();
  const board = useBoard();
  const press = usePressState();
  const now = useNowPlaying();
  const autoplayBlocked = useAutoplayBlocked();
  const amb = useAmbience();
  const [pref, setPref] = useState<DevicePref | null>(loadDevicePref);
  const [notice, setNotice] = useState<string | null>(null);
  const [showReady, setShowReady] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showUntagged, setShowUntagged] = usePref('prefs.showUntagged', false);
  const [fadeOn, setFadeOn] = usePref(FADE_PREF, true);
  const deviceSelect = useRef<HTMLSelectElement>(null);
  const strip = useStripMode(setNotice);
  const [route, go] = useRoute(board.scenes.length > 0 ? 'board' : 'library');

  const playback = useMemo(
    () =>
      createPlayback({
        pipeline,
        store: deviceStore,
        browser: createSdkDevice(webPlayback),
        sdkStatus: webPlayback.getStatus,
        notify: setNotice,
      }),
    [],
  );

  useEffect(() => {
    void loadLibrary();
    void bootPlayer();
    return startNowPlaying();
  }, []);

  // Keep cached scene names in step with Spotify (renames, retags).
  useEffect(() => {
    if (library.status !== 'ok') return;
    const names = new Map(library.playlists.map((p) => [p.id, p.name]));
    updateBoard((b) => syncNames(b, names));
  }, [library]);

  const playlists = library.status === 'ok' ? library.playlists : [];
  const byId = library.status === 'ok' ? library.byId : new Map<string, Playlist>();
  const statusOf = (playlistId: string) => itemStatus(playlistId, press, displayStatus(playlistId, press, now));
  const onBoard = (playlistId: string) => isOnBoard(board, playlistId);
  const toggleBoard = (p: Playlist) => updateBoard((b) => toggleOnBoard(b, p));

  const chooseDevice = () => {
    deviceSelect.current?.scrollIntoView({ block: 'center' });
    deviceSelect.current?.focus();
    void deviceStore.refresh().catch(() => {});
  };

  const play = (p: Playlist) => {
    write('prefs.lastPlaylist', p.id);
    if (!playback.play({ id: p.id, total: trackCount(p) }, pref)) {
      setNotice('Choose where the music plays first.');
      chooseDevice();
    }
  };
  /** Board tiles, the strip and number keys play a scene: its playlist, and its ambience (D29). */
  const playScene = (scene: Scene) => {
    if (scene.ambience) {
      ambience.unlock(); // first, while still inside the click
      ambience.applyPreset(scene.ambience);
    }
    const p = byId.get(scene.playlistId);
    if (p) play(p);
  };
  const soundNames = new Map(ambience.sounds.map((s) => [s.id, s.name]));
  const tileAmbience: TileAmbience = {
    current: ambience.mix(),
    names: (preset) => preset.map((l) => soundNames.get(l.soundId) ?? `${l.soundId} (missing)`).join(', '),
    save: (sceneId, preset) => updateBoard((b) => setSceneAmbience(b, sceneId, preset)),
  };
  const togglePause = () => playback.togglePause(pref, now.state);
  const next = () => void playback.next(pref, now.state).then(() => setTimeout(() => void refreshNowPlaying(), 600));
  const skipRemove = useSkipRemove({ now, byId, myId: library.status === 'ok' ? library.myId : null, next });

  useShortcuts(
    {
      openPalette: () => library.status === 'ok' && !strip.compact && !strip.pip && setShowPalette(true),
      playTile: (n) => {
        const scene = boardOrder(board)[n - 1];
        if (scene) playScene(scene);
      },
    },
    !showPalette,
    strip.pip,
  );

  const stripProps = {
    board,
    byId,
    press,
    now,
    canControl: !!pref,
    statusOf,
    notice,
    onPlay: playScene,
    onToggle: togglePause,
    onNext: next,
  };
  const floatButton = canFloat() && !strip.pip && (
    <button onClick={strip.float} title="Always on top, over other windows">
      Float
    </button>
  );
  const floating =
    strip.pip &&
    createPortal(<Strip {...stripProps} actions={<button onClick={() => strip.pip!.close()}>Back to app</button>} />, strip.pip.document.body);

  if (strip.compact) {
    return (
      <>
        <Strip
          {...stripProps}
          actions={
            <>
              {floatButton}
              <button onClick={strip.exitCompact}>Expand</button>
            </>
          }
        />
        {floating}
      </>
    );
  }

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
          <a href="#/ambience" aria-current={route === 'ambience' ? 'page' : undefined}>
            Ambience
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
          <button
            onClick={() => {
              setShowPalette(false);
              strip.enterCompact();
            }}
            title="Narrow strip for beside Notion"
          >
            Compact
          </button>
          {floatButton}
          <button className="link" onClick={onShowLog}>
            Log
          </button>
          <button className="link" onClick={logoutEverything}>
            Log out
          </button>
        </nav>
      </header>

      {strip.pip && (
        <p className="notice">
          The strip is floating on top of your other windows. <button onClick={() => strip.pip!.focus()}>Show it</button>{' '}
          <button onClick={() => strip.pip!.close()}>Close it</button>
        </p>
      )}
      <DevicePicker
        ref={deviceSelect}
        pref={pref}
        onChange={(p) => {
          saveDevicePref(p);
          setPref(p);
          setNotice(null);
        }}
      />
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
        <ReadyCheck playlists={playlists} pref={pref} makeDevice={playback.deviceFor} onClose={() => setShowReady(false)} />
      )}

      {route === 'ambience' ? (
        <Ambience engine={ambience} state={amb} />
      ) : route === 'spike' && library.status === 'ok' ? (
        <Spike playlists={library.playlists} myId={library.myId} />
      ) : route === 'board' && library.status === 'ok' ? (
        <Board
          board={board}
          byId={byId}
          statusOf={statusOf}
          onPlay={playScene}
          onRemove={(id) => updateBoard((b) => removeScene(b, id))}
          onMoveScene={(from, to) => updateBoard((b) => moveScene(b, from, to))}
          onMoveSection={(key, dir) => updateBoard((b) => moveSection(b, key, dir))}
          onOpenLibrary={() => go('library')}
          ambience={tileAmbience}
        />
      ) : (
        <Library
          library={library}
          showUntagged={showUntagged}
          onShowUntagged={setShowUntagged}
          statusOf={statusOf}
          isOnBoard={onBoard}
          onPlay={play}
          onToggleBoard={toggleBoard}
          onRetry={loadLibrary}
          onChooseDevice={chooseDevice}
        />
      )}

      {showPalette && (
        <Palette
          playlists={playlists.filter((p) => isListed(p.name, showUntagged))}
          isOnBoard={onBoard}
          onPlay={play}
          onToggleBoard={toggleBoard}
          onClose={() => setShowPalette(false)}
        />
      )}
      <div className="player-dock">
        <AmbienceMini engine={ambience} state={amb} onOpen={() => go('ambience')} />
        {skipRemove.notice}
        <PlayerBar
          docked
          fade={{ on: fadeOn, toggle: () => setFadeOn(!fadeOn) }}
          press={press}
          now={now}
          byId={byId}
          canControl={!!pref}
          onToggle={togglePause}
          onNext={next}
          skipRemove={skipRemove.button}
        />
      </div>
      {floating}
    </div>
  );
}

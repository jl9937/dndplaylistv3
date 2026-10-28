import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { daysUntilRelogin, logout, type CallbackResult } from './auth/auth';
import { RELOGIN_WARN_DAYS } from './config';
import { log } from './diagnostics/log';
import { deviceStore, loadDevicePref, saveDevicePref, type DevicePref } from './playback/devices';
import { createRemoteDevice, pipeline } from './playback/pipeline';
import { getMe, getMyPlaylists } from './spotify/api';
import { trackCount, type Playlist } from './spotify/types';
import { write } from './storage';
import { DebugPanel } from './ui/DebugPanel';
import { DevicePicker } from './ui/DevicePicker';
import { useAuthStatus, usePressState } from './ui/hooks';
import { LoginScreen } from './ui/LoginScreen';
import { PlayerBar } from './ui/PlayerBar';
import { PlaylistList, type Library } from './ui/PlaylistList';
import { ReadyCheck } from './ui/ReadyCheck';

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
  const [library, setLibrary] = useState<Library>({ status: 'loading' });
  const [myId, setMyId] = useState<string | null>(null);
  const [pref, setPref] = useState<DevicePref | null>(loadDevicePref);
  const [showReady, setShowReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const press = usePressState();
  const deviceSelect = useRef<HTMLSelectElement>(null);

  const load = useCallback(async () => {
    setLibrary({ status: 'loading' });
    try {
      const [me, playlists] = await Promise.all([getMe(), getMyPlaylists()]);
      setMyId(me.id);
      setLibrary({ status: 'ok', playlists });
      log('app', `library loaded: ${playlists.length} playlists`);
    } catch (e) {
      setLibrary({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const device = useMemo(() => (pref ? createRemoteDevice(pref, deviceStore) : null), [pref]);

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

  const onPress = (p: Playlist) => {
    if (!device) {
      setNotice('Choose where the music plays first.');
      chooseDevice();
      return;
    }
    setNotice(null);
    write('prefs.lastPlaylist', p.id);
    void pipeline.press({ id: p.id, total: trackCount(p) }, device);
  };

  const onLogout = () => {
    pipeline.reset();
    deviceStore.clear();
    logout();
  };

  const playlists = library.status === 'ok' ? library.playlists : [];
  const currentName =
    press.status !== 'idle' ? (playlists.find((p) => p.id === press.playlistId)?.name ?? null) : null;
  const days = daysUntilRelogin();

  return (
    <div className="app">
      <header className="top">
        <h1>D&amp;D Playlist Manager</h1>
        {days !== null && days <= RELOGIN_WARN_DAYS && (
          <span className="warn">Re-login needed in {days} days</span>
        )}
        <nav>
          <button onClick={() => setShowReady((v) => !v)} disabled={library.status !== 'ok'}>
            Ready check
          </button>
          <button className="link" onClick={onShowLog}>Log</button>
          <button className="link" onClick={onLogout}>Log out</button>
        </nav>
      </header>

      <DevicePicker ref={deviceSelect} pref={pref} onChange={choosePref} />
      {notice && <p className="notice">{notice}</p>}

      {showReady && library.status === 'ok' && (
        <ReadyCheck playlists={playlists} pref={pref} onClose={() => setShowReady(false)} />
      )}

      <PlayerBar
        press={press}
        playlistName={currentName}
        canControl={!!device}
        onPause={() => device && void pipeline.pause(device)}
        onResume={() => device && void pipeline.resume(device)}
      />

      <PlaylistList
        library={library}
        myId={myId}
        press={press}
        onPress={onPress}
        onRetry={load}
        onChooseDevice={chooseDevice}
      />
    </div>
  );
}

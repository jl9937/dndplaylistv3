import { useEffect, type Ref } from 'react';
import { startLogin } from '../auth/auth';
import { deviceStore, firstRunDefault, isUsable, matchDevice, type DevicePref } from '../playback/devices';
import { takeOverPlayer, webPlayback } from '../player/instance';
import { BROWSER_PREF } from '../player/sdkDevice';
import { describeSdk, SDK_PLAYER_NAME } from '../player/webPlayback';
import { useDevices, useSdkStatus } from './hooks';

const keyOf = (p: DevicePref) => `${p.type}\u0000${p.name}`;
export const isBrowserPref = (p: DevicePref | null) => p?.type === BROWSER_PREF.type;

export function DevicePicker({
  pref,
  onChange,
  ref,
}: {
  pref: DevicePref | null;
  onChange: (pref: DevicePref) => void;
  ref?: Ref<HTMLSelectElement>;
}) {
  const { devices: all, loading, error } = useDevices();
  const sdk = useSdkStatus();

  useEffect(() => {
    deviceStore.refresh().catch(() => {});
  }, []);

  // Our own SDK player is listed by Spotify too; show it once, as "This browser".
  const devices = all.filter((d) => d.name !== SDK_PLAYER_NAME);
  const browser = isBrowserPref(pref);
  const suggested = !pref ? firstRunDefault(devices) : undefined;
  const chosenListed = browser || (pref ? matchDevice(devices, pref) : undefined);
  const hasPhone = devices.some((d) => d.type.toLowerCase() === 'smartphone');
  const sdkReady = sdk.state === 'ready';

  return (
    <section className="devices">
      <label htmlFor="device">Plays on</label>
      <div className="device-row">
        <select
          id="device"
          ref={ref}
          value={pref ? keyOf(pref) : ''}
          onChange={(e) => {
            if (e.target.value === keyOf(BROWSER_PREF)) return onChange(BROWSER_PREF);
            const d = devices.find((x) => keyOf(x) === e.target.value);
            if (d) onChange({ name: d.name, type: d.type });
          }}
        >
          {!pref && <option value="">Choose a device…</option>}
          {pref && !browser && !chosenListed && <option value={keyOf(pref)}>{pref.name} (not open)</option>}
          {devices.map((d) => (
            <option key={keyOf(d)} value={keyOf(d)} disabled={!isUsable(d)}>
              {d.name} · {d.type}
              {d.is_active ? ' · active' : ''}
              {d.is_restricted ? ' · can’t be controlled' : ''}
            </option>
          ))}
          <option value={keyOf(BROWSER_PREF)}>This browser (this window) · {describeSdk(sdk)}</option>
        </select>
        <button onClick={() => deviceStore.refresh().catch(() => {})} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {suggested && (
        <p className="hint">
          Use <strong>{suggested.name}</strong>?{' '}
          <button className="primary" onClick={() => onChange({ name: suggested.name, type: suggested.type })}>
            Confirm
          </button>
        </p>
      )}
      {error && <p className="hint error">Couldn’t list devices: {error}</p>}
      {pref && !chosenListed && !loading && (
        <p className="hint">
          Spotify isn’t open on {pref.name}.{' '}
          {sdkReady ? 'Presses will play in this window instead until you open it.' : 'Open it, then refresh.'}
        </p>
      )}
      {!hasPhone && devices.length > 0 && (
        <p className="hint subtle">Phone not listed? Open Spotify on your phone, then refresh.</p>
      )}
      <SdkLine />
    </section>
  );
}

/** "This browser" status, with the one action that fixes it (spec §12.2). */
function SdkLine() {
  const sdk = useSdkStatus();
  if (sdk.state === 'ready' || sdk.state === 'loading' || sdk.state === 'connecting' || sdk.state === 'waiting') return null;
  if (sdk.state === 'off' && sdk.reason === 'not-started') return null;
  let action = null;
  if (sdk.state === 'off' && sdk.reason === 'needs-scope') {
    action = <button onClick={() => void startLogin()}>Log in again</button>;
  } else if (sdk.state === 'off' && sdk.reason === 'other-tab') {
    action = <button onClick={() => void takeOverPlayer()}>Use this tab instead</button>;
  } else if (sdk.state === 'failed' && sdk.action === 'relogin') {
    action = <button onClick={() => void startLogin()}>Log in again</button>;
  } else if (sdk.state === 'failed' && (sdk.action === 'reload' || sdk.action === 'allow')) {
    action = <button onClick={() => location.reload()}>Reload page</button>;
  }
  return (
    <p className={`hint subtle sdk-line ${sdk.state}`}>
      In-browser player: {describeSdk(sdk)} {action}
      {sdk.state === 'recovering' && <button className="link" onClick={() => void webPlayback.recover()}>Retry now</button>}
    </p>
  );
}

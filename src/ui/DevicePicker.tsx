import { useEffect, type Ref } from 'react';
import { deviceStore, firstRunDefault, isUsable, matchDevice, type DevicePref } from '../playback/devices';
import { useDevices } from './hooks';

const keyOf = (p: DevicePref) => `${p.type}\u0000${p.name}`;

export function DevicePicker({ pref, onChange, ref }: {
  pref: DevicePref | null;
  onChange: (pref: DevicePref) => void;
  ref?: Ref<HTMLSelectElement>;
}) {
  const { devices, loading, error } = useDevices();

  useEffect(() => {
    deviceStore.refresh().catch(() => {});
  }, []);

  const suggested = !pref ? firstRunDefault(devices) : undefined;
  const chosenListed = pref ? matchDevice(devices, pref) : undefined;
  const hasPhone = devices.some((d) => d.type.toLowerCase() === 'smartphone');

  return (
    <section className="devices">
      <label htmlFor="device">Plays on</label>
      <div className="device-row">
        <select
          id="device"
          ref={ref}
          value={pref ? keyOf(pref) : ''}
          onChange={(e) => {
            const d = devices.find((x) => keyOf(x) === e.target.value);
            if (d) onChange({ name: d.name, type: d.type });
          }}
        >
          {!pref && <option value="">Choose a device…</option>}
          {pref && !chosenListed && (
            <option value={keyOf(pref)}>
              {pref.name} (not open)
            </option>
          )}
          {devices.map((d) => (
            <option key={keyOf(d)} value={keyOf(d)} disabled={!isUsable(d)}>
              {d.name} · {d.type}
              {d.is_active ? ' · active' : ''}
              {d.is_restricted ? ' · can’t be controlled' : ''}
            </option>
          ))}
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
      {!loading && !error && devices.length === 0 && (
        <p className="hint">No Spotify devices found. Open the Spotify desktop app, then refresh.</p>
      )}
      {pref && !chosenListed && !loading && devices.length > 0 && (
        <p className="hint">Spotify isn’t open on {pref.name}. Open it, then refresh.</p>
      )}
      {!hasPhone && devices.length > 0 && (
        <p className="hint subtle">Phone not listed? Open Spotify on your phone, then refresh.</p>
      )}
    </section>
  );
}

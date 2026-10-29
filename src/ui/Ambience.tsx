import type { Ambience as Engine, AmbienceState } from '../ambience/engine';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The mixer tab (US-4-2). Every handler runs inside a click, so unlock() can start audio. */
export function Ambience({ engine, state }: { engine: Engine; state: AmbienceState }) {
  const anyOn = Object.values(state.layers).some((l) => l.on);
  if (engine.sounds.length === 0) {
    return (
      <section className="ambience empty">
        <p>No ambience sounds yet.</p>
        <p className="hint subtle">
          Put looping audio files in the repo’s <code>ambience/</code> folder (see its README) and deploy. They appear here, named after the
          file.
        </p>
      </section>
    );
  }
  return (
    <section className="ambience">
      <div className="ambience-master">
        <label>
          <span>Ambience volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.master}
            onChange={(e) => engine.setMaster(Number(e.target.value))}
            aria-valuetext={percent(state.master)}
          />
        </label>
        <button onClick={() => engine.stopAll()} disabled={!anyOn}>
          Stop all
        </button>
        {state.suspended && (
          <button className="primary" onClick={engine.unlock}>
            Resume ambience
          </button>
        )}
      </div>
      <p className="hint subtle">Plays from this computer, whatever device plays the music. To save a mix on a Board tile, use the tile’s ≈ button.</p>
      <ul className="layers">
        {engine.sounds.map((sound) => {
          const layer = state.layers[sound.id];
          return (
            <li key={sound.id} className={`layer ${layer.status}`}>
              <button
                className={`layer-toggle${layer.on ? ' on' : ''}`}
                aria-pressed={layer.on}
                onClick={() => {
                  engine.unlock();
                  engine.toggle(sound.id);
                }}
              >
                <span className="layer-name">{sound.name}</span>
                <span className="layer-status">{layer.status === 'loading' ? 'Loading…' : layer.on ? 'On' : 'Off'}</span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.volume}
                onChange={(e) => engine.setVolume(sound.id, Number(e.target.value))}
                aria-label={`${sound.name} volume`}
                aria-valuetext={percent(layer.volume)}
              />
              {layer.status === 'error' && <span className="layer-error">Couldn’t play: {layer.error}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** In the player dock: what's on, master volume, Stop. Hidden until something plays. */
export function AmbienceMini({ engine, state, onOpen }: { engine: Engine; state: AmbienceState; onOpen: () => void }) {
  const on = engine.sounds.filter((s) => state.layers[s.id].on);
  if (on.length === 0) return null;
  return (
    <section className="ambience-mini" aria-label="Ambience">
      <button className="link" onClick={onOpen} title="Open the mixer">
        ≈ {on.map((s) => s.name).join(', ')}
      </button>
      {state.suspended ? (
        <button className="primary" onClick={engine.unlock}>
          Resume ambience
        </button>
      ) : (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.master}
          onChange={(e) => engine.setMaster(Number(e.target.value))}
          aria-label="Ambience volume"
          aria-valuetext={percent(state.master)}
        />
      )}
      <button onClick={() => engine.stopAll()}>Stop</button>
    </section>
  );
}

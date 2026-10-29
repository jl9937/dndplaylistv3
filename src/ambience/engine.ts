// The ambience mixer (spec §13.3): looping layers through Web Audio, independent of Spotify.
//
//   AudioBufferSourceNode (loop) → layer GainNode → master GainNode → speakers
//
// Each layer holds what's wanted (on, volume); the graph is brought into line with it. A layer
// turned off while its file is still loading never starts. All gain changes are ramps, so
// nothing clicks.

import type { Sound } from './sounds';

export type LayerStatus = 'off' | 'loading' | 'on' | 'error';

export interface LayerState {
  /** Slider position, 0–1. Kept while the layer is off. */
  volume: number;
  on: boolean;
  status: LayerStatus;
  error?: string;
}

export interface AmbienceState {
  master: number;
  layers: Record<string, LayerState>;
  /** Something should be playing but the browser has audio suspended: needs a click. */
  suspended: boolean;
}

/** One layer of a scene's preset. */
export interface PresetLayer {
  soundId: string;
  volume: number;
}

export interface AmbienceDeps {
  sounds: Sound[];
  createContext: () => AudioContext;
  load?: (url: string) => Promise<ArrayBuffer>;
  random?: () => number;
  initial?: { master?: number; volumes?: Record<string, number> };
}

export const LAYER_FADE_MS = 1000;
export const PRESET_FADE_MS = 3000;
export const DEFAULT_VOLUME = 0.6;
/** Decoded buffers kept for layers that are off, so toggling back is instant. */
const SPARE_BUFFERS = 3;

/** Slider to gain: squared, so the slider's travel sounds even. */
export const toGain = (v: number) => clamp(v) ** 2;
const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const defaultLoad = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
};

export function createAmbience(deps: AmbienceDeps) {
  const load = deps.load ?? defaultLoad;
  const random = deps.random ?? Math.random;
  const byId = new Map(deps.sounds.map((s) => [s.id, s]));

  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let master = clamp(deps.initial?.master ?? 0.8);
  const layers = new Map<string, LayerState>(
    deps.sounds.map((s) => [s.id, { volume: clamp(deps.initial?.volumes?.[s.id] ?? DEFAULT_VOLUME), on: false, status: 'off' }]),
  );
  const live = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let recent: string[] = [];

  const listeners = new Set<() => void>();
  let state: AmbienceState = snapshot();
  function snapshot(): AmbienceState {
    const anyOn = [...layers.values()].some((l) => l.on);
    return {
      master,
      layers: Object.fromEntries([...layers].map(([id, l]) => [id, { ...l }])),
      suspended: anyOn && !!ctx && ctx.state !== 'running',
    };
  }
  const emit = () => {
    state = snapshot();
    listeners.forEach((fn) => fn());
  };

  function rampTo(param: AudioParam, value: number, ms: number) {
    const t = ctx!.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + ms / 1000);
  }

  /** Create or resume the AudioContext. Call synchronously inside a click (autoplay rules). */
  function unlock() {
    if (!ctx) {
      ctx = deps.createContext();
      masterGain = ctx.createGain();
      masterGain.gain.value = toGain(master);
      masterGain.connect(ctx.destination);
      ctx.addEventListener('statechange', emit);
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    emit();
  }

  function buffer(id: string): Promise<AudioBuffer> {
    let p = buffers.get(id);
    if (!p) {
      const sound = byId.get(id)!;
      p = load(sound.url).then((data) => ctx!.decodeAudioData(data));
      buffers.set(id, p);
      p.catch(() => buffers.delete(id));
    }
    recent = [id, ...recent.filter((r) => r !== id)];
    return p;
  }

  /** Drop decoded audio nobody needs: it's large (about 46 MB for 2 minutes of stereo). */
  function evict() {
    const keep = new Set([...live.keys(), ...[...layers].filter(([, l]) => l.on).map(([id]) => id)]);
    recent.filter((id) => !keep.has(id)).slice(0, SPARE_BUFFERS).forEach((id) => keep.add(id));
    for (const id of buffers.keys()) if (!keep.has(id)) buffers.delete(id);
    recent = recent.filter((id) => buffers.has(id));
  }

  function start(id: string, audio: AudioBuffer, fadeMs: number) {
    const layer = layers.get(id)!;
    const source = ctx!.createBufferSource();
    source.buffer = audio;
    source.loop = true;
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(masterGain!);
    // A random start, so a layer doesn't begin on the same bar every time.
    source.start(0, audio.duration * random());
    live.set(id, { source, gain });
    rampTo(gain.gain, toGain(layer.volume), fadeMs);
  }

  function stop(id: string, fadeMs: number) {
    const node = live.get(id);
    if (!node) return;
    live.delete(id);
    rampTo(node.gain.gain, 0, fadeMs);
    node.source.stop(ctx!.currentTime + fadeMs / 1000);
    node.source.onended = () => node.gain.disconnect();
  }

  function setOn(id: string, on: boolean, fadeMs = LAYER_FADE_MS) {
    const layer = layers.get(id);
    if (!layer || layer.on === on) return;
    layer.on = on;
    layer.error = undefined;
    if (!on) {
      layer.status = 'off';
      stop(id, fadeMs);
      evict();
      emit();
      return;
    }
    if (!ctx) unlock();
    layer.status = 'loading';
    emit();
    buffer(id).then(
      (audio) => {
        if (!layer.on || live.has(id)) return; // turned off (or restarted) while loading
        layer.status = 'on';
        start(id, audio, fadeMs);
        evict();
        emit();
      },
      (err: unknown) => {
        if (!layer.on) return;
        layer.on = false;
        layer.status = 'error';
        layer.error = err instanceof Error && err.message ? err.message : 'could not decode this file';
        emit();
      },
    );
  }

  function setVolume(id: string, volume: number) {
    const layer = layers.get(id);
    if (!layer) return;
    layer.volume = clamp(volume);
    const node = live.get(id);
    if (node) rampTo(node.gain.gain, toGain(layer.volume), 80);
    emit();
  }

  function setMaster(volume: number) {
    master = clamp(volume);
    if (masterGain) rampTo(masterGain.gain, toGain(master), 50);
    emit();
  }

  function stopAll(fadeMs = LAYER_FADE_MS) {
    for (const id of layers.keys()) setOn(id, false, fadeMs);
  }

  /** Crossfade to a scene's preset (D29). Sounds no longer in the folder are skipped. */
  function applyPreset(preset: PresetLayer[], fadeMs = PRESET_FADE_MS) {
    const wanted = new Map(preset.filter((p) => layers.has(p.soundId)).map((p) => [p.soundId, clamp(p.volume)]));
    for (const id of layers.keys()) if (!wanted.has(id)) setOn(id, false, fadeMs);
    for (const [id, volume] of wanted) {
      if (layers.get(id)!.on) setVolume(id, volume);
      else {
        layers.get(id)!.volume = volume;
        setOn(id, true, fadeMs);
      }
    }
    emit();
  }

  /** The current mix, to save on a tile. */
  function mix(): PresetLayer[] {
    return [...layers].filter(([, l]) => l.on).map(([soundId, l]) => ({ soundId, volume: l.volume }));
  }

  return {
    sounds: deps.sounds,
    unlock,
    setOn,
    toggle: (id: string) => setOn(id, !layers.get(id)?.on),
    setVolume,
    setMaster,
    stopAll,
    applyPreset,
    mix,
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

export type Ambience = ReturnType<typeof createAmbience>;

import { describe, expect, it } from 'vitest';
import { createAmbience, toGain, type AmbienceDeps } from '../src/ambience/engine';
import { soundsFromFiles, type Sound } from '../src/ambience/sounds';

/** Records ramps: the last scheduled target is what the param is heading for. */
class FakeParam {
  value = 1;
  target = 1;
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.target = v;
  }
}
class FakeNode {
  gain = new FakeParam();
  connected: unknown[] = [];
  connect(n: unknown) {
    this.connected.push(n);
  }
  disconnect() {
    this.connected = [];
  }
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  startedAt: number | null = null;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  start(_when: number, offset: number) {
    this.startedAt = offset;
  }
  stop(when: number) {
    this.stopAt = when;
  }
}
class FakeContext {
  currentTime = 10;
  state: AudioContextState = 'suspended';
  destination = {};
  sources: FakeSource[] = [];
  resumed = 0;
  private onState: (() => void) | null = null;
  createGain() {
    return new FakeNode();
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer) {
    if (data.byteLength === 0) throw new Error('Unable to decode audio data');
    return { duration: 60 };
  }
  async resume() {
    this.resumed++;
    this.setState('running');
  }
  addEventListener(_: string, fn: () => void) {
    this.onState = fn;
  }
  setState(s: AudioContextState) {
    this.state = s;
    this.onState?.();
  }
}

const sounds: Sound[] = [
  { id: 'Fire.ogg', name: 'Fire', url: '/a/fire.ogg' },
  { id: 'Rain.ogg', name: 'Rain', url: '/a/rain.ogg' },
  { id: 'Wind.ogg', name: 'Wind', url: '/a/wind.ogg' },
];

function make(over: Partial<AmbienceDeps> = {}) {
  const ctx = new FakeContext();
  const loads: string[] = [];
  const amb = createAmbience({
    sounds,
    createContext: () => ctx as unknown as AudioContext,
    load: async (url) => {
      loads.push(url);
      return new ArrayBuffer(url.includes('broken') ? 0 : 8);
    },
    random: () => 0.5,
    ...over,
  });
  return { amb, ctx, loads };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const live = (ctx: FakeContext) => ctx.sources.filter((s) => s.stopAt === null);

describe('ambience sounds', () => {
  it('names sounds after their files, sorted A–Z, with the file name as a stable id', () => {
    const found = soundsFromFiles({
      '../../ambience/tavern crowd.ogg': '/assets/tavern-1.ogg',
      '../../ambience/Cave drips.opus': '/assets/cave-2.opus',
    });
    expect(found).toEqual([
      { id: 'Cave drips.opus', name: 'Cave drips', url: '/assets/cave-2.opus' },
      { id: 'tavern crowd.ogg', name: 'tavern crowd', url: '/assets/tavern-1.ogg' },
    ]);
  });
});

describe('the ambience engine', () => {
  it('needs a click first: unlock creates and resumes the AudioContext', () => {
    const { amb, ctx } = make();
    expect(ctx.resumed).toBe(0);
    amb.unlock();
    expect(ctx.resumed).toBe(1);
  });

  it('turning a layer on loads it, loops it from a random point, and fades it in', async () => {
    const { amb, ctx } = make();
    amb.unlock();
    amb.setOn('Rain.ogg', true);
    expect(amb.getState().layers['Rain.ogg'].status).toBe('loading');
    await flush();
    const [src] = ctx.sources;
    expect(src.loop).toBe(true);
    expect(src.startedAt).toBe(30); // half of 60 s
    const gain = src.connected[0] as FakeNode;
    expect(gain.gain.value).toBe(0);
    expect(gain.gain.target).toBeCloseTo(toGain(0.6));
    expect(amb.getState().layers['Rain.ogg'].status).toBe('on');
  });

  it('turning a layer off fades it, then stops it', async () => {
    const { amb, ctx } = make();
    amb.setOn('Rain.ogg', true);
    await flush();
    amb.setOn('Rain.ogg', false);
    const [src] = ctx.sources;
    expect((src.connected[0] as FakeNode).gain.target).toBe(0);
    expect(src.stopAt).toBe(11); // currentTime + 1 s fade
    expect(amb.getState().layers['Rain.ogg']).toMatchObject({ on: false, status: 'off' });
  });

  it('a layer turned off while loading never starts', async () => {
    const { amb, ctx } = make();
    amb.setOn('Rain.ogg', true);
    amb.setOn('Rain.ogg', false);
    await flush();
    expect(ctx.sources).toEqual([]);
  });

  it('a quick off-and-on starts exactly one new source', async () => {
    const { amb, ctx } = make();
    amb.setOn('Rain.ogg', true);
    await flush();
    amb.setOn('Rain.ogg', false);
    amb.setOn('Rain.ogg', true);
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect(live(ctx)).toHaveLength(1);
  });

  it('a file that fails to decode shows the reason and leaves the others playing', async () => {
    const { amb, ctx } = make({ sounds: [...sounds, { id: 'Bad.ogg', name: 'Bad', url: '/a/broken.ogg' }] });
    amb.setOn('Fire.ogg', true);
    amb.setOn('Bad.ogg', true);
    await flush();
    expect(amb.getState().layers['Bad.ogg']).toMatchObject({ on: false, status: 'error', error: 'Unable to decode audio data' });
    expect(live(ctx)).toHaveLength(1);
  });

  it('volume and master are ramps, not jumps, and the slider is kept while off', async () => {
    const { amb, ctx } = make();
    amb.unlock();
    amb.setVolume('Wind.ogg', 0.3);
    expect(amb.getState().layers['Wind.ogg'].volume).toBe(0.3);
    amb.setOn('Wind.ogg', true);
    await flush();
    amb.setVolume('Wind.ogg', 1);
    expect((ctx.sources[0].connected[0] as FakeNode).gain.target).toBe(1);
    amb.setMaster(0.5);
    expect(amb.getState().master).toBe(0.5);
    amb.setVolume('Wind.ogg', 7);
    expect(amb.getState().layers['Wind.ogg'].volume).toBe(1);
  });

  it('a preset crossfades: other layers fade out over 3 s, preset layers come in at their volumes', async () => {
    const { amb, ctx } = make();
    amb.setOn('Fire.ogg', true);
    amb.setOn('Wind.ogg', true);
    await flush();
    amb.applyPreset([
      { soundId: 'Rain.ogg', volume: 0.9 },
      { soundId: 'Wind.ogg', volume: 0.2 },
      { soundId: 'Gone.ogg', volume: 1 }, // removed from the folder since: skipped
    ]);
    await flush();
    const fire = ctx.sources[0];
    expect(fire.stopAt).toBe(13);
    expect(amb.mix()).toEqual([
      { soundId: 'Rain.ogg', volume: 0.9 },
      { soundId: 'Wind.ogg', volume: 0.2 },
    ]);
    expect(live(ctx)).toHaveLength(2); // Wind carried on rather than restarting
  });

  it('stop all turns everything off', async () => {
    const { amb, ctx } = make();
    amb.applyPreset([{ soundId: 'Rain.ogg', volume: 1 }, { soundId: 'Fire.ogg', volume: 1 }]);
    await flush();
    amb.stopAll();
    expect(live(ctx)).toEqual([]);
    expect(amb.mix()).toEqual([]);
  });

  it('reports suspended audio while something should play, so the UI can ask for a click', async () => {
    const { amb, ctx } = make();
    amb.setOn('Rain.ogg', true);
    await flush();
    expect(amb.getState().suspended).toBe(false);
    ctx.setState('suspended');
    expect(amb.getState().suspended).toBe(true);
    amb.unlock();
    await flush();
    expect(amb.getState().suspended).toBe(false);
  });

  it('keeps decoded audio for recently used layers, and drops the rest', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `S${i}`, name: `S${i}`, url: `/a/s${i}` }));
    const { amb, loads } = make({ sounds: many });
    for (const s of many) {
      amb.setOn(s.id, true);
      await flush();
      amb.setOn(s.id, false);
    }
    amb.setOn('S5', true); // recent: reused
    amb.setOn('S0', true); // evicted: loaded again
    await flush();
    expect(loads.filter((u) => u === '/a/s5')).toHaveLength(1);
    expect(loads.filter((u) => u === '/a/s0')).toHaveLength(2);
  });

  it('starts from saved volumes', () => {
    const { amb } = make({ initial: { master: 0.4, volumes: { 'Rain.ogg': 0.1 } } });
    expect(amb.getState().master).toBe(0.4);
    expect(amb.getState().layers['Rain.ogg'].volume).toBe(0.1);
    expect(amb.getState().layers['Fire.ogg'].volume).toBe(0.6);
  });
});

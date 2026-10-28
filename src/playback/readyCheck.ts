// Pre-session Ready check (spec §12.6). Reuses the real pipeline for the test play.

import { daysUntilRelogin, getAccessToken } from '../auth/auth';
import { RELOGIN_WARN_DAYS } from '../config';
import { getPlaybackState } from '../spotify/api';
import { sleep } from '../sleep';
import { matchDevice, type DevicePref, type DeviceStore } from './devices';
import type { Pipeline, PlayerDevice, PlaylistRef } from './pipeline';

export type StepStatus = 'pending' | 'running' | 'ok' | 'warn' | 'fail';

export interface ReadyStep {
  key: 'token' | 'device' | 'play' | 'mode';
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface ReadyCheckInput {
  pref: DevicePref | null;
  playlist: (PlaylistRef & { name: string }) | null;
  store: DeviceStore;
  pipeline: Pipeline;
  makeDevice: (pref: DevicePref) => PlayerDevice;
  onUpdate: (steps: ReadyStep[]) => void;
}

export function initialSteps(): ReadyStep[] {
  return [
    { key: 'token', label: 'Spotify login', status: 'pending' },
    { key: 'device', label: 'Device listed', status: 'pending' },
    { key: 'play', label: 'Test play confirmed, then paused', status: 'pending' },
    { key: 'mode', label: 'Shuffle on, repeat playlist', status: 'pending' },
  ];
}

export async function runReadyCheck(input: ReadyCheckInput): Promise<ReadyStep[]> {
  let steps = initialSteps();
  const update = (key: ReadyStep['key'], patch: Partial<ReadyStep>) => {
    steps = steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
    input.onUpdate(steps);
  };
  const failRest = (from: ReadyStep['key'][]) =>
    from.forEach((key) => update(key, { status: 'fail', detail: 'Skipped' }));

  // 1. Token
  update('token', { status: 'running' });
  try {
    await getAccessToken();
    const days = daysUntilRelogin();
    if (days !== null && days <= RELOGIN_WARN_DAYS) {
      update('token', { status: 'warn', detail: `Re-login needed in ${days} days` });
    } else {
      update('token', { status: 'ok', detail: days === null ? undefined : `${days} days until re-login` });
    }
  } catch (e) {
    update('token', { status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    failRest(['device', 'play', 'mode']);
    return steps;
  }

  // 2. Device
  update('device', { status: 'running' });
  if (!input.pref) {
    update('device', { status: 'fail', detail: 'Choose a device first' });
    failRest(['play', 'mode']);
    return steps;
  }
  try {
    const found = matchDevice(await input.store.refresh(), input.pref);
    if (!found) {
      update('device', { status: 'fail', detail: `Spotify isn't open on ${input.pref.name}` });
      failRest(['play', 'mode']);
      return steps;
    }
    update('device', { status: 'ok', detail: `${found.name} (${found.type})` });
  } catch (e) {
    update('device', { status: 'fail', detail: e instanceof Error ? e.message : String(e) });
    failRest(['play', 'mode']);
    return steps;
  }

  // 3. Test play through the real pipeline, then 4. read shuffle/repeat, then pause.
  if (!input.playlist) {
    update('play', { status: 'fail', detail: 'Choose a test playlist' });
    failRest(['mode']);
    return steps;
  }
  update('play', { status: 'running', detail: input.playlist.name });
  const device = input.makeDevice(input.pref);
  const result = await input.pipeline.press(input.playlist, device);
  if (result.status !== 'playing') {
    update('play', { status: 'fail', detail: result.status === 'failed' ? result.reason : 'Superseded' });
    failRest(['mode']);
    return steps;
  }

  update('mode', { status: 'running' });
  try {
    await sleep(500); // let the shuffle/repeat commands land
    const state = await getPlaybackState();
    const shuffleOk = state?.shuffle_state === true;
    const repeatOk = state?.repeat_state === 'context';
    update('mode', {
      status: shuffleOk && repeatOk ? 'ok' : 'warn',
      detail: `Shuffle ${state?.shuffle_state ? 'on' : 'off'}, repeat ${state?.repeat_state ?? 'unknown'}`,
    });
  } catch (e) {
    update('mode', { status: 'warn', detail: e instanceof Error ? e.message : String(e) });
  }

  const paused = await input.pipeline.pause(device);
  update('play', paused.status === 'paused'
    ? { status: 'ok', detail: `${input.playlist.name}: played, then paused` }
    : { status: 'warn', detail: `Played, but pausing failed${paused.status === 'failed' ? `: ${paused.reason}` : ''}` });
  return steps;
}

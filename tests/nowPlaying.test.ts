import { describe, expect, it } from 'vitest';
import { displayStatus, type NowPlaying } from '../src/playback/nowPlaying';
import type { PressState } from '../src/playback/pipeline';
import type { PlaybackState } from '../src/spotify/types';

const playing: PressState = { status: 'playing', seq: 1, playlistId: 'PL1', deviceLabel: 'Mac' };
const observed = (uri: string | null, isPlaying = true): PlaybackState => ({
  device: null,
  is_playing: isPlaying,
  progress_ms: 1,
  shuffle_state: true,
  repeat_state: 'context',
  context: uri ? { uri, type: 'playlist' } : null,
  item: null,
});
const now = (state: PlaybackState | null | undefined, at: number | null, pressSettledAt = 100): NowPlaying => ({
  state,
  at,
  error: null,
  pressSettledAt,
});

describe('displayStatus', () => {
  it('is idle for other playlists', () => {
    expect(displayStatus('PL2', playing, now(undefined, null))).toBe('idle');
  });

  it('trusts the press until a newer observation arrives', () => {
    expect(displayStatus('PL1', playing, now(observed('spotify:playlist:OTHER'), 50))).toBe('playing');
  });

  it('drops Playing when Spotify has since moved to another playlist', () => {
    expect(displayStatus('PL1', playing, now(observed('spotify:playlist:OTHER'), 200))).toBe('idle');
    expect(displayStatus('PL1', playing, now(null, 200))).toBe('idle');
  });

  it('shows Paused when paused in the Spotify app, Playing when resumed there', () => {
    const paused: PressState = { ...playing, status: 'paused' };
    expect(displayStatus('PL1', playing, now(observed('spotify:playlist:PL1', false), 200))).toBe('paused');
    expect(displayStatus('PL1', paused, now(observed('spotify:playlist:PL1', true), 200))).toBe('playing');
  });

  it('never overrides starting or failed', () => {
    const failed: PressState = { status: 'failed', seq: 1, playlistId: 'PL1', reason: 'x', deviceMissing: false };
    expect(displayStatus('PL1', failed, now(observed('spotify:playlist:PL1'), 200))).toBe('failed');
  });
});

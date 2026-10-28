import { describe, expect, it, vi } from 'vitest';
import { createFallbackDevice } from '../src/playback/fallback';
import { DeviceMissingError, type PlayerDevice } from '../src/playback/device';

function device(label: string, resolve: PlayerDevice['resolve']): PlayerDevice {
  return {
    label,
    prepareGesture: vi.fn(),
    resolve: vi.fn(resolve),
    sendPlay: vi.fn(async () => {}),
    sendResume: vi.fn(async () => {}),
    sendPause: vi.fn(async () => {}),
    sendNext: vi.fn(async () => {}),
    observe: vi.fn(async () => null),
    wake: vi.fn(async () => {}),
    setShuffle: vi.fn(async () => {}),
    setRepeatContext: vi.fn(async () => {}),
  };
}

const signal = new AbortController().signal;
const req = { contextUri: 'spotify:playlist:x' };

describe('fallback device', () => {
  it('uses the chosen device when it is listed', async () => {
    const mac = device('MacBook Pro', async () => 'mac');
    const browser = device('This browser', async () => 'sdk');
    const onFallBack = vi.fn();
    const d = createFallbackDevice(mac, browser, () => true, onFallBack);
    expect(await d.resolve(signal)).toBe('mac');
    await d.sendPlay('mac', req, signal);
    expect(mac.sendPlay).toHaveBeenCalled();
    expect(onFallBack).not.toHaveBeenCalled();
    expect(d.label).toBe('MacBook Pro');
  });

  it('falls back to this window, with a notice, when the app is not listed', async () => {
    const mac = device('MacBook Pro', async () => {
      throw new DeviceMissingError('MacBook Pro');
    });
    const browser = device('This browser', async () => 'sdk');
    const onFallBack = vi.fn();
    const d = createFallbackDevice(mac, browser, () => true, onFallBack);
    expect(await d.resolve(signal)).toBe('sdk');
    expect(onFallBack).toHaveBeenCalledWith('MacBook Pro');
    await d.sendPlay('sdk', req, signal);
    expect(browser.sendPlay).toHaveBeenCalled();
    expect(mac.sendPlay).not.toHaveBeenCalled();
    expect(d.label).toBe('This browser');
  });

  it('does not fall back when the in-browser player is unavailable, or for other errors', async () => {
    const missing = device('MacBook Pro', async () => {
      throw new DeviceMissingError('MacBook Pro');
    });
    const browser = device('This browser', async () => 'sdk');
    await expect(createFallbackDevice(missing, browser, () => false, vi.fn()).resolve(signal)).rejects.toBeInstanceOf(
      DeviceMissingError,
    );
    const broken = device('MacBook Pro', async () => {
      throw new Error('network');
    });
    await expect(createFallbackDevice(broken, browser, () => true, vi.fn()).resolve(signal)).rejects.toThrow('network');
    expect(browser.resolve).not.toHaveBeenCalled();
  });

  it('passes volume control through to the active device (soft transitions)', async () => {
    const mac = { ...device('MacBook Pro', async () => 'mac'), setVolume: vi.fn(async () => {}), fadeSteps: 3 };
    const browser = { ...device('This browser', async () => 'sdk'), setVolume: vi.fn(async () => {}), fadeSteps: 12 };
    const d = createFallbackDevice(mac, browser, () => true, vi.fn());
    await d.resolve(signal);
    await d.setVolume!('mac', 40, signal);
    expect(mac.setVolume).toHaveBeenCalledWith('mac', 40, signal);
    expect(d.fadeSteps).toBe(3);
  });

  it('activates the in-browser player on the click, in case it falls back later', () => {
    const mac = device('MacBook Pro', async () => 'mac');
    const browser = device('This browser', async () => 'sdk');
    createFallbackDevice(mac, browser, () => true, vi.fn()).prepareGesture!();
    expect(browser.prepareGesture).toHaveBeenCalled();
  });
});

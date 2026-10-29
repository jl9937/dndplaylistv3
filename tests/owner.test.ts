import { describe, expect, it, vi } from 'vitest';
import { isOwner, lockedOutMessage, verifyOwner } from '../src/auth/owner';
import { SpotifyError } from '../src/spotify/client';

describe('owner lock (D35)', () => {
  it('lets only the owner through, and everyone when no owner is set', () => {
    expect(isOwner('jim', 'jim')).toBe(true);
    expect(isOwner('mallory', 'jim')).toBe(false);
    expect(isOwner(undefined, 'jim')).toBe(false);
    expect(isOwner('anyone', '')).toBe(true);
  });

  it('the owner’s login carries on', async () => {
    const logout = vi.fn();
    expect(await verifyOwner({ getMe: async () => ({ id: 'jim' }), logout, owner: 'jim' })).toEqual({ kind: 'ok' });
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs anyone else straight out, saying why', async () => {
    const logout = vi.fn();
    expect(await verifyOwner({ getMe: async () => ({ id: 'mallory' }), logout, owner: 'jim' })).toEqual({
      kind: 'error',
      message: lockedOutMessage('mallory'),
    });
    expect(logout).toHaveBeenCalledOnce();
  });

  it('an account Spotify refuses (not registered) is logged out too', async () => {
    const logout = vi.fn();
    const refused = async () => {
      throw new SpotifyError('unknown', 403, 'Spotify error: User not registered in the Developer Dashboard');
    };
    expect(await verifyOwner({ getMe: refused, logout, owner: 'jim' })).toEqual({ kind: 'error', message: lockedOutMessage() });
    expect(logout).toHaveBeenCalledOnce();
  });

  it('fails closed on a network fault, but doesn’t call it a refusal', async () => {
    const logout = vi.fn();
    const offline = async () => {
      throw new SpotifyError('network', 0, 'No connection');
    };
    const r = await verifyOwner({ getMe: offline, logout, owner: 'jim' });
    expect(r).toMatchObject({ kind: 'error', message: expect.stringContaining('Couldn’t confirm') });
    expect(logout).toHaveBeenCalledOnce();
  });

  it('is off, and asks Spotify nothing, when no owner is configured', async () => {
    const getMe = vi.fn();
    expect(await verifyOwner({ getMe, logout: vi.fn(), owner: '' })).toEqual({ kind: 'ok' });
    expect(getMe).not.toHaveBeenCalled();
  });
});

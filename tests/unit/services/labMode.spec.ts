// Regression guard: Lab Mode exit must always leave fullscreen (#33 regression).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaveLabModeDevice } from '../../../src/services/labMode';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('leaveLabModeDevice', () => {
  it('exits fullscreen when the document is fullscreen', async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });

    await leaveLabModeDevice();

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does not throw when exitFullscreen rejects', async () => {
    const exitFullscreen = vi.fn(async () => { throw new Error('not allowed'); });
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });

    await expect(leaveLabModeDevice()).resolves.toBeUndefined();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does not call exitFullscreen when fullscreenElement is null', async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true });

    await leaveLabModeDevice();

    expect(exitFullscreen).not.toHaveBeenCalled();
  });
});

// 2.0.0-beta.1 follow-up: a waiting service worker update is applied by itself
// on an untouched page, so a plain reload lands on the new release.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_UPDATE_GUARD_KEY, AUTO_UPDATE_GUARD_MS, markAutoApplied, mayShowUpdateToast, noteUserInteraction,
  resetUpdateGateForTests, setSessionActive, setUpdatePending, shouldAutoApplyUpdate, startInteractionWatch,
} from '../../../src/services/updateGate';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('updateGate: auto-apply a waiting update on an untouched page', () => {
  beforeEach(() => resetUpdateGateForTests());

  it('applies when an update is pending, the page is untouched and no Lab session runs', () => {
    setUpdatePending(true);
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(true);
  });

  it('never applies without a pending update', () => {
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(false);
  });

  it('never applies during a Lab session (the toast waits too)', () => {
    setUpdatePending(true);
    setSessionActive(true);
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(false);
    expect(mayShowUpdateToast()).toBe(false);
  });

  it('after any interaction it falls back to the toast, so typed input is never lost', () => {
    setUpdatePending(true);
    noteUserInteraction();
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(false);
    expect(mayShowUpdateToast()).toBe(true);
  });

  it('reloads at most once a minute, so a broken update cannot loop', () => {
    const storage = memoryStorage();
    setUpdatePending(true);
    markAutoApplied(10_000, storage);
    expect(storage.getItem(AUTO_UPDATE_GUARD_KEY)).toBe('10000');
    expect(shouldAutoApplyUpdate(10_000 + AUTO_UPDATE_GUARD_MS - 1, storage)).toBe(false);
    expect(shouldAutoApplyUpdate(10_000 + AUTO_UPDATE_GUARD_MS, storage)).toBe(true);
  });

  it('still applies when storage is unavailable or throws', () => {
    setUpdatePending(true);
    expect(shouldAutoApplyUpdate(1_000, null)).toBe(true);
    const throwing = { getItem: () => { throw new Error('blocked'); } };
    expect(shouldAutoApplyUpdate(1_000, throwing)).toBe(true);
  });

  it('the interaction watch flips on the first pointer, key or touch and then detaches', () => {
    const target = new EventTarget();
    startInteractionWatch(target as unknown as Window);
    setUpdatePending(true);
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(true);
    target.dispatchEvent(new Event('keydown'));
    expect(shouldAutoApplyUpdate(1_000, memoryStorage())).toBe(false);
  });
});

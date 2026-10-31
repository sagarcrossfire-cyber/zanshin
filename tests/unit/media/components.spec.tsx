// Amendment 01B — the media components: nothing renders (and nothing is
// read) until media exists, fallbacks keep the ink look, art can be turned
// off, and the clip player's speed, frame-step and keyboard controls work.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterHero, CharacterIcon } from '../../../src/components/media/CharacterArt';
import { MediaImage } from '../../../src/components/media/MediaImage';
import { ClipBadge, MoveClip, MoveClipCard, MoveClipPicker, stepTime } from '../../../src/components/media/MoveClip';
import { defaultSettings } from '../../../src/data/bootstrap';
import { mediaAssetId, mediaRepo, resetDbForTests } from '../../../src/data/repos';
import type { MediaKind } from '../../../src/data/schemas';
import { refreshMediaIndex, resetMediaLibraryForTests } from '../../../src/services/mediaLibrary';
import { useAppStore } from '../../../src/stores/appStore';

// jsdom has no object URLs and no media playback: stand-ins that keep state.
const paused = new WeakMap<HTMLMediaElement, boolean>();
const times = new WeakMap<HTMLMediaElement, number>();
const saved: Array<[object, string, PropertyDescriptor | undefined]> = [];
let urlCounter = 0;

function override(target: object, key: string, descriptor: PropertyDescriptor): void {
  saved.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

beforeAll(() => {
  override(URL, 'createObjectURL', { value: vi.fn(() => `blob:zanshin/${++urlCounter}`), writable: true });
  override(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  const proto = HTMLMediaElement.prototype;
  override(proto, 'paused', { get(this: HTMLMediaElement) { return paused.get(this) ?? true; } });
  override(proto, 'currentTime', {
    get(this: HTMLMediaElement) { return times.get(this) ?? 0; },
    set(this: HTMLMediaElement, value: number) { times.set(this, value); },
  });
  override(proto, 'duration', { get() { return 2; } });
  override(proto, 'play', {
    value: vi.fn(function play(this: HTMLMediaElement) {
      paused.set(this, false);
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }),
    writable: true,
  });
  override(proto, 'pause', {
    value: vi.fn(function pause(this: HTMLMediaElement) {
      paused.set(this, true);
      this.dispatchEvent(new Event('pause'));
    }),
    writable: true,
  });
});

afterAll(() => {
  for (const [target, key, descriptor] of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<string, unknown>)[key];
  }
});

async function seed(kind: MediaKind, subjectKey: string, mime = 'image/png'): Promise<void> {
  const id = mediaAssetId(kind, subjectKey);
  const blobKey = `${id}#1`;
  await mediaRepo.put(
    {
      blobKey, bytes: 3, id, importedAt: '2026-10-30T10:00:00.000Z', kind, mime,
      origin: 'pack', sha256: 'c'.repeat(64), subjectKey,
    },
    [{ data: new Uint8Array([1, 2, 3]), key: blobKey }],
  );
}

beforeEach(async () => {
  await resetDbForTests();
  resetMediaLibraryForTests();
  useAppStore.setState({ settings: defaultSettings() });
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
});

afterEach(() => {
  // Unmount before touching the store, so no mounted component re-renders
  // outside act().
  cleanup();
  useAppStore.setState({ settings: null });
});

describe('stepTime', () => {
  it('moves one 60 fps frame and clamps to the clip', () => {
    expect(stepTime(1, 1, 2)).toBeCloseTo(1 + 1 / 60);
    expect(stepTime(1, -1, 2)).toBeCloseTo(1 - 1 / 60);
    expect(stepTime(0, -1, 2)).toBe(0);
    expect(stepTime(2, 1, 2)).toBe(2);
    expect(stepTime(5, 1, Number.NaN)).toBeCloseTo(5 + 1 / 60);
    expect(stepTime(0, 3, undefined, 30)).toBeCloseTo(0.1);
  });
});

describe('CharacterIcon', () => {
  it('renders nothing while no character icons were imported (the app looks as before)', () => {
    const { container } = render(<CharacterIcon name="Jin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the imported icon, and an initials tile for characters without one', async () => {
    await seed('character-icon', 'character:Jin');
    await act(async () => { await refreshMediaIndex(); });
    const { container } = render(
      <>
        <CharacterIcon name="Jin" />
        <CharacterIcon name="Kazuya" decorative />
      </>,
    );
    const jin = await screen.findByRole('img', { name: 'Jin' });
    await waitFor(() => expect(jin.querySelector('img')?.getAttribute('src')).toMatch(/^blob:zanshin\//));
    const kazuya = container.querySelector('[data-media="fallback"]');
    expect(kazuya).toHaveTextContent('K');
    expect(kazuya).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders nothing when art is switched off', async () => {
    await seed('character-icon', 'character:Jin');
    await act(async () => { await refreshMediaIndex(); });
    useAppStore.setState({ settings: { ...defaultSettings(), mediaShowArt: false } });
    const { container } = render(<CharacterIcon name="Jin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in Safe Mode', async () => {
    await seed('character-icon', 'character:Jin');
    await act(async () => { await refreshMediaIndex(); });
    window.localStorage.setItem('zanshin:safe-mode', '1');
    try {
      const { container } = render(<CharacterIcon name="Jin" />);
      expect(container).toBeEmptyDOMElement();
    } finally {
      window.localStorage.removeItem('zanshin:safe-mode');
    }
  });
});

describe('CharacterHero', () => {
  it('renders only its children when no portrait was imported', () => {
    const { container } = render(<CharacterHero name="Yoshimitsu"><h1>Today</h1></CharacterHero>);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(container.querySelector('.z-hero')).toBeNull();
  });

  it('puts the portrait behind a plate that holds the children', async () => {
    await seed('character-portrait', 'character:Yoshimitsu');
    await act(async () => { await refreshMediaIndex(); });
    const { container } = render(<CharacterHero name="Yoshimitsu"><h1>Today</h1></CharacterHero>);
    expect(container.querySelector('.z-hero')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('.z-hero__img')).not.toBeNull());
    expect(container.querySelector('.z-hero__img')).toHaveAttribute('alt', '');
    expect(container.querySelector('.z-hero__plate h1')).toHaveTextContent('Today');
  });

  it('applies the ink treatment when chosen', async () => {
    await seed('character-portrait', 'character:Yoshimitsu');
    await act(async () => { await refreshMediaIndex(); });
    useAppStore.setState({ settings: { ...defaultSettings(), mediaInkArt: true } });
    const { container } = render(<CharacterHero name="Yoshimitsu" />);
    expect(container.querySelector('.z-hero')).toHaveClass('z-art--ink');
  });
});

describe('MediaImage', () => {
  it('renders nothing without the image, and the image once imported', async () => {
    const { container, rerender } = render(<MediaImage kind="rank-badge" subjectKey="rank:Tekken King" width={48} />);
    expect(container).toBeEmptyDOMElement();
    await seed('rank-badge', 'rank:Tekken King');
    await act(async () => { await refreshMediaIndex(); });
    rerender(<MediaImage kind="rank-badge" subjectKey="rank:Tekken King" width={48} alt="Tekken King" />);
    expect(await screen.findByRole('img', { name: 'Tekken King' })).toBeInTheDocument();
    expect(container.querySelector('.z-art-image')).toHaveStyle({ height: '48px', width: '48px' });
  });
});

describe('MoveClip', () => {
  it('renders nothing (not even a box) when the move has no clip', () => {
    const { container } = render(
      <>
        <MoveClip moveId="Yoshimitsu-1,2" label="1,2" />
        <MoveClipCard moveId="Yoshimitsu-1,2" label="1,2" />
        <ClipBadge moveId="Yoshimitsu-1,2" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('plays, pauses, changes speed and steps frames', async () => {
    await seed('move-clip', 'move:Yoshimitsu-1,2', 'video/mp4');
    await act(async () => { await refreshMediaIndex(); });
    render(<MoveClip moveId="Yoshimitsu-1,2" label="Flash, 1,2" context="codex" />);
    const video = await screen.findByLabelText('Flash, 1,2 clip', { selector: 'video' }) as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video.playbackRate).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '0.25×' }));
    expect(screen.getByRole('button', { name: '0.25×' })).toHaveAttribute('aria-pressed', 'true');
    expect(video.playbackRate).toBe(0.25);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Forward one frame' }));
    expect(video.currentTime).toBeCloseTo(1 / 60);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back one frame' }));
    expect(video.currentTime).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
    expect(video.loop).toBe(false);
  });

  it('answers the keyboard on the focused clip: Space or K plays, comma and period step', async () => {
    await seed('move-clip', 'move:Yoshimitsu-1,2', 'video/mp4');
    await act(async () => { await refreshMediaIndex(); });
    render(<MoveClip moveId="Yoshimitsu-1,2" label="1,2" context="codex" />);
    const figure = await screen.findByRole('figure');
    const video = await screen.findByLabelText('1,2 clip', { selector: 'video' }) as HTMLVideoElement;
    fireEvent.keyDown(figure, { key: ' ' });
    expect(video.paused).toBe(false);
    fireEvent.keyDown(figure, { key: 'k' });
    expect(video.paused).toBe(true);
    fireEvent.keyDown(figure, { key: '.' });
    fireEvent.keyDown(figure, { key: '.' });
    expect(video.currentTime).toBeCloseTo(2 / 60);
    fireEvent.keyDown(figure, { key: ',' });
    expect(video.currentTime).toBeCloseTo(1 / 60);
  });

  it('leaves Space to Lab Mode in Lab drills and starts at the Lab speed', async () => {
    await seed('move-clip', 'move:Yoshimitsu-1,2', 'video/mp4');
    await act(async () => { await refreshMediaIndex(); });
    render(<MoveClip moveId="Yoshimitsu-1,2" label="1,2" context="lab" />);
    const figure = await screen.findByRole('figure');
    const video = await screen.findByLabelText('1,2 clip', { selector: 'video' }) as HTMLVideoElement;
    expect(screen.getByRole('button', { name: '0.5×' })).toHaveAttribute('aria-pressed', 'true');
    const spaceEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    figure.dispatchEvent(spaceEvent);
    expect(spaceEvent.defaultPrevented).toBe(false);
    expect(video.paused).toBe(true);
    fireEvent.keyDown(figure, { key: 'K' });
    expect(video.paused).toBe(false);
  });

  it('shows a badge and a Clip card once the clip exists', async () => {
    await seed('move-clip', 'move:Yoshimitsu-1,2', 'video/mp4');
    await act(async () => { await refreshMediaIndex(); });
    render(
      <>
        <ClipBadge moveId="Yoshimitsu-1,2" />
        <MoveClipCard moveId="Yoshimitsu-1,2" label="1,2" />
      </>,
    );
    expect(screen.getByLabelText('Has an imported clip')).toBeInTheDocument();
    expect(screen.getByText('Clip')).toBeInTheDocument();
  });
});

describe('MoveClipPicker', () => {
  it('offers only the moves that have clips, one clip at a time', async () => {
    await seed('move-clip', 'move:Yoshimitsu-1,2', 'video/mp4');
    await seed('move-clip', 'move:Yoshimitsu-b+1+4', 'video/mp4');
    await act(async () => { await refreshMediaIndex(); });
    render(
      <MoveClipPicker
        context="lab"
        choices={[
          { label: '1,2', moveId: 'Yoshimitsu-1,2' },
          { label: 'df+2', moveId: 'Yoshimitsu-df+2' },
          { label: 'b+1+4', moveId: 'Yoshimitsu-b+1+4' },
        ]}
      />,
    );
    const choices = screen.getByRole('group', { name: 'Choose a clip' });
    expect(choices.querySelectorAll('button')).toHaveLength(2);
    expect(await screen.findByLabelText('1,2 clip', { selector: 'video' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'b+1+4' }));
    expect(await screen.findByLabelText('b+1+4 clip', { selector: 'video' })).toBeInTheDocument();
    expect(screen.queryByLabelText('1,2 clip', { selector: 'video' })).toBeNull();
  });

  it('renders nothing when none of the moves has a clip', () => {
    const { container } = render(<MoveClipPicker choices={[{ label: '1,2', moveId: 'Yoshimitsu-1,2' }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

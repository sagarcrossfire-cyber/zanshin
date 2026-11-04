import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyArt, EmptyNote, type EmptyScene } from '../../../src/components/decor/EmptyArt';

describe('illustrated empty states (2.0 M6)', () => {
  it('draws every scene, hidden from assistive tech', () => {
    for (const scene of ['lantern', 'dojo', 'washi', 'gravel', 'moon'] as EmptyScene[]) {
      const { container, unmount } = render(<EmptyArt scene={scene} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('path, rect, circle, ellipse, line').length).toBeGreaterThan(2);
      unmount();
    }
  });

  it('keeps the message as the readable content', () => {
    const { getByText } = render(<EmptyNote scene="lantern"><p>No logged sets yet.</p></EmptyNote>);
    expect(getByText('No logged sets yet.').tagName).toBe('P');
  });
});

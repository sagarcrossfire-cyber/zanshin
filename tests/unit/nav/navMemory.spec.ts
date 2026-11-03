// QA M3(c): rememberRoute strips one-shot prefill params (about, q) before
// storing a hub's last route, so reopening a hub never re-fires a stale
// "Ask the coach about this" or "Look it up" prefill.
import { beforeEach, describe, expect, it } from 'vitest';
import { hubTarget, rememberRoute } from '../../../src/app/navMemory';

describe('rememberRoute — strips one-shot prefill params', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('drops ?about= from a remembered Coach route', () => {
    rememberRoute('/coach/ask', '?about=1%2B4');
    expect(hubTarget('coach', '/coach/ask')).toBe('/coach/ask');
  });

  it('drops ?q= from a remembered Coach route', () => {
    rememberRoute('/coach/research', '?q=jin+f%2Cf%2B2');
    expect(hubTarget('coach', '/coach/ask')).toBe('/coach/research');
  });

  it('keeps other query params and drops only about/q', () => {
    rememberRoute('/coach/ask', '?about=thing&keep=1');
    expect(hubTarget('coach', '/coach/ask')).toBe('/coach/ask?keep=1');
  });

  it('a route with no query string stores no trailing "?"', () => {
    rememberRoute('/lab', '');
    expect(hubTarget('train', '/lab')).toBe('/lab');
  });
});

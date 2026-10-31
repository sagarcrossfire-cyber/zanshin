/* Rasterize PWA icons — spec §4.9. Converts public/brand/logo-mark.svg to PNGs
 * via @resvg/resvg-js (already a devDependency; no sharp needed). Run:
 *   npm run rasterize-icons
 * Outputs on --bg (#0E0F11): 10% safe padding, 20% for maskable.
 * STUB: none — resvg is available in this repo. If resvg is ever removed, this
 * script exits non-zero with a clear message instead of writing placeholders. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Background comes from tokens.css (dark --bg), never a literal here: the
// no-color-literals rule forbids hex values outside tokens.css.
const tokensCss = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');
const BG = tokensCss.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
if (!BG) throw new Error('tokens.css: could not read dark --bg');

function wrapped(svg: string, size: number, padPercent: number): string {
  const m = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  if (!m) throw new Error('logo-mark.svg: could not parse outer <svg>');
  const pad = padPercent;
  const attrs = (m[1] ?? '').replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '').replace(/\sviewBox="[^"]*"/, '');
  const body = m[2] ?? '';
  const inner = `<svg${attrs} x="${pad}" y="${pad}" width="${100 - 2 * pad}" height="${100 - 2 * pad}" viewBox="0 0 120 120">${body}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" fill="${BG}"/>${inner}</svg>`;
}

function render(svg: string, size: number, out: string): void {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: BG });
  writeFileSync(out, resvg.render().asPng());
  console.log(`wrote ${out} (${size}x${size})`);
}

const src = readFileSync(join(ROOT, 'public/brand/logo-mark.svg'), 'utf8');
const outDir = join(ROOT, 'public/icons');
mkdirSync(outDir, { recursive: true });
render(wrapped(src, 192, 10), 192, join(outDir, 'app-192.png'));
render(wrapped(src, 512, 10), 512, join(outDir, 'app-512.png'));
render(wrapped(src, 512, 20), 512, join(outDir, 'maskable-512.png'));
render(wrapped(src, 180, 10), 180, join(outDir, 'apple-touch-180.png'));
console.log('rasterize-icons: done');

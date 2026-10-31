// Makes sure the site always has a media manifest (release 1.2.0). The deploy
// pipeline writes the real one with `npm run media:site`; a build without it
// (a local build, a pull-request check) gets an empty manifest instead, so the
// app's start-up check gets a quiet "nothing here" answer rather than a 404.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'public', 'media');
const file = join(dir, 'manifest.json');
if (!existsSync(file)) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    format: 'zanshin-media-pack',
    generator: 'ensure-media-manifest (no bundled media in this build)',
    items: [],
    misses: [],
    packId: 'empty',
    version: 1,
  }, null, 1)}\n`);
  console.log('ensure-media-manifest: wrote an empty public/media/manifest.json');
} else {
  console.log('ensure-media-manifest: public/media/manifest.json present');
}

#!/usr/bin/env bash
# Builds ZANSHIN inside Netlify's build system (used when a deploy is started
# from Netlify itself, for example through the Netlify MCP connector). The
# steady-state path is GitHub Actions, which deploys a finished `dist` with
# --no-build and never runs this. Same gate, same media, same build either way.
set -euo pipefail

echo "== quick gate"
npm run typecheck
npm run lint
npm run test

echo "== bundled media from Wavu Wiki (cached under node_modules/.cache between builds)"
python3 --version
python3 -m pip install --quiet --disable-pip-version-check pillow || echo "pillow unavailable; portraits stay PNG"
python3 scripts/make_zanshin_media_pack.py --site-dir public --cache-dir node_modules/.cache/zanshin-media --delay 0.5

echo "== build"
npm run build
node scripts/check-bundle.mjs
node -e "const m=require('./dist/media/manifest.json'); console.log(m.items.length, 'media items,', m.packId)"

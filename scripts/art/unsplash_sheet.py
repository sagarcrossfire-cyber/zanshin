#!/usr/bin/env python3
"""
unsplash_sheet.py - REVIEW ONLY (2.0 M6): download each approved Unsplash
candidate (scripts/art/candidates.json, from design.md §D.3) at 800 px from the
image URL the Unsplash connector's download_asset returned (that call records
the download), convert to grayscale the way the app tints them, and lay
them out on one contact sheet with their numbers. Nothing enters the site.
Needs Pillow. Runs in GitHub Actions only (the sandbox cannot reach Unsplash).
"""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

USER_AGENT = "ZANSHIN-art/1.0 (personal training app; one user)"
HERE = Path(__file__).parent


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def main():
    cands = json.loads((HERE / "candidates.json").read_text(encoding="utf-8"))["candidates"]
    tiles, report = [], {}
    for c in cands:
        # The Unsplash connector's download_asset recorded each download and gave these
        # image URLs (unsplash.com's own download link now needs a login).
        url = c["image"] + "?ixlib=rb-4.1.0&fm=jpg&q=80&w=800"
        time.sleep(1.0)
        try:
            img = Image.open(io.BytesIO(fetch(url)))
            img.load()
            report[c["id"]] = {"n": c["n"], "width": img.width, "height": img.height}
            gray = ImageOps.grayscale(img).convert("RGB")
            gray.thumbnail((360, 240))
            tiles.append((c, gray))
        except Exception as err:
            report[c["id"]] = {"n": c["n"], "error": str(err)}
            tiles.append((c, None))
        print("#%-2d %-12s %s" % (c["n"], c["id"], json.dumps(report[c["id"]])), flush=True)
    cols, tw, th = 5, 370, 272
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (24, 26, 32))
    draw = ImageDraw.Draw(sheet)
    for i, (c, img) in enumerate(tiles):
        x, y = (i % cols) * tw + 5, (i // cols) * th + 5
        draw.rectangle([x, y, x + 360, y + 240], fill=(48, 52, 62))
        if img is not None:
            sheet.paste(img, (x + (360 - img.width) // 2, y + (240 - img.height) // 2))
        draw.text((x + 2, y + 244), "#%d %s  %s" % (c["n"], c["id"], c["suits"][:34]), fill=(235, 235, 235))
    out = Path("art-review"); out.mkdir(exist_ok=True)
    sheet.save(out / "unsplash-sheet.png")
    (out / "unsplash-sheet.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
make_art_pack.py - 2.0 M6 scene art. Downloads the picked Unsplash photos
(scripts/art/picks.json; image URLs from candidates.json, obtained through the
Unsplash connector's download_asset, which records each download), turns them
grayscale (the app tints them per colour scheme), and writes
public/art/<hub>-<w>.{avif,webp} at 800 and 1600 px wide plus
src/data/art-credits.json. Runs in GitHub Actions (the sandbox cannot reach
Unsplash); the art-review workflow commits the output to the art/** branch.
Needs Pillow; AVIF is written when this Pillow build supports it.
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps, features

USER_AGENT = "ZANSHIN-art/1.0 (personal training app; one user)"
ROOT = Path(__file__).resolve().parents[2]
WIDTHS = (800, 1600)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def main():
    cands = {c["id"]: c for c in json.loads((ROOT / "scripts/art/candidates.json").read_text("utf-8"))["candidates"]}
    picks = json.loads((ROOT / "scripts/art/picks.json").read_text("utf-8"))["halls"]
    out_dir = ROOT / "public/art"
    out_dir.mkdir(parents=True, exist_ok=True)
    avif = features.check("avif")
    print("AVIF support:", avif, flush=True)
    credits, total = [], 0
    for hub, pick in picks.items():
        c = cands[pick["id"]]
        src = Image.open(io.BytesIO(fetch(c["image"] + "?ixlib=rb-4.1.0&fm=jpg&q=90&w=1600")))
        src.load()
        gray = ImageOps.autocontrast(ImageOps.grayscale(src), cutoff=1)
        files = {}
        for w in WIDTHS:
            img = gray if gray.width <= w else gray.resize((w, round(gray.height * w / gray.width)), Image.LANCZOS)
            for fmt, ext, kw in (("WEBP", "webp", {"quality": 62, "method": 6}), ("AVIF", "avif", {"quality": 42})):
                if fmt == "AVIF" and not avif:
                    continue
                buf = io.BytesIO()
                img.save(buf, fmt, **kw)
                name = "%s-%d.%s" % (hub, w, ext)
                (out_dir / name).write_bytes(buf.getvalue())
                files[name] = len(buf.getvalue())
                total += len(buf.getvalue())
        print("%-6s %-12s %s" % (hub, c["id"], json.dumps(files)), flush=True)
        credits.append({
            "hub": hub, "id": c["id"], "photographer": c["photographer"], "handle": c["handle"],
            "page": c["page"].split("?")[0], "position": pick["position"],
            "formats": ["avif", "webp"] if avif else ["webp"], "license": "Unsplash License",
        })
    (ROOT / "src/data/art-credits.json").write_text(json.dumps({"halls": credits}, indent=1, ensure_ascii=False) + "\n", "utf-8")
    print("total bytes", total, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

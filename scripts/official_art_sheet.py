#!/usr/bin/env python3
"""
official_art_sheet.py - LOG ONLY (2.0 M6): fetch each character's
img_01.png from the official Tekken 8 site, report size and transparency,
and paste them onto one contact sheet (official-art-sheet.png) so a human can
check by eye that they are full-body Tekken 8 renders before any is used.
Needs Pillow. Runs in GitHub Actions only.
"""
import io
import json
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

USER_AGENT = "ZANSHIN-art-discovery/1.0 (personal training app; one user; log-only)"
BASE = "https://tk8.tekken-official.jp/images/character/%s/img_01.png"
NAMES = ["Anna", "Armor King", "Bob", "Clive", "Eddy", "Fahkumram", "Heihachi", "Kunimitsu", "Miary Zo",
         "Yoshimitsu"]  # Yoshimitsu as a known-good reference against his Wavu portrait


def slug(name):
    return name.lower().replace(" ", "_")


def main():
    report, tiles = {}, []
    for name in NAMES:
        url = BASE % slug(name)
        time.sleep(1.0)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            img = Image.open(io.BytesIO(data))
            rgba = img.convert("RGBA")  # palette PNGs carry transparency in tRNS
            alpha = rgba.getchannel("A").getextrema()[0] < 255
            report[name] = {"url": url, "width": img.width, "height": img.height, "mode": img.mode,
                            "transparent": bool(alpha), "bytes": len(data)}
            thumb = rgba.copy()
            thumb.thumbnail((300, 420))
            tiles.append((name, thumb))
        except Exception as err:
            report[name] = {"url": url, "error": str(err)}
            tiles.append((name, None))
        print("%-11s %s" % (name, json.dumps(report[name])), flush=True)
    sheet = Image.new("RGBA", (5 * 310, 2 * 450), (30, 34, 44, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (name, thumb) in enumerate(tiles):
        x, y = (i % 5) * 310 + 5, (i // 5) * 450 + 5
        draw.rectangle([x, y, x + 300, y + 420], fill=(60, 66, 80, 255))
        if thumb is not None:
            sheet.alpha_composite(thumb, (x + (300 - thumb.width) // 2, y + 420 - thumb.height))
        draw.text((x + 4, y + 424), name, fill=(240, 240, 240, 255))
    sheet.convert("RGB").save("official-art-sheet.png")
    with open("official-art.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())

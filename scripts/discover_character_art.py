#!/usr/bin/env python3
"""
discover_character_art.py - LOG ONLY: find Tekken 8 full-body renders for the
characters Wavu Wiki has no portrait for (2.0 M6).

Nothing is downloaded into the site. The script prints, per character, every
candidate image URL it finds, with size when the source reports one, and
writes the same to a JSON file (uploaded as a CI artifact) so a human can
choose a source before any of it is used.

Sources tried, one request at a time, politely:
  1. Tekken Fandom wiki (MediaWiki API): file-name search per character.
  2. The official Tekken 8 site: character pages, every <img>/srcset/og:image/
     CSS url() whose address names the character.

Standard library only. Runs in GitHub Actions (the build sandbox cannot
reach these hosts).
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "ZANSHIN-art-discovery/1.0 (personal training app; one user; log-only)"
FANDOM_API = "https://tekken.fandom.com/api.php"
OFFICIAL_SEEDS = [
    "https://tk8.tekken-official.jp/en/character/",
    "https://tk8.tekken-official.jp/character/",
    "https://www.bandainamcoent.com/games/tekken-8",
    "https://en.bandainamcoent.eu/tekken/tekken-8",
]
DEFAULT_NAMES = ["Anna", "Armor King", "Bob", "Clive", "Eddy", "Fahkumram", "Heihachi", "Kunimitsu", "Miary Zo"]
# Extra spellings the sources use.
ALIASES = {
    "Anna": ["Anna Williams"], "Clive": ["Clive Rosfield"], "Eddy": ["Eddy Gordo"],
    "Heihachi": ["Heihachi Mishima"], "Armor King": ["ArmorKing", "Armor_King"], "Miary Zo": ["Miary", "MiaryZo"],
}
IMG_EXT = re.compile(r"\.(png|webp|jpe?g|avif)(\?|$)", re.I)


def log(msg):
    print(msg, flush=True)


class Polite:
    def __init__(self, delay):
        self.delay, self.last = delay, 0.0

    def get(self, url):
        gap = time.monotonic() - self.last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self.last = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.geturl(), resp.read()


def norm(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def keys_for(name):
    return {norm(n) for n in [name] + ALIASES.get(name, [])} | {norm(name.split(" ")[0])}


def fandom(client, name):
    found = []
    for prefix in sorted({name, name.split(" ")[0], "T8 " + name, "T8_" + name.split(" ")[0]} | set(ALIASES.get(name, []))):
        url = FANDOM_API + "?" + urllib.parse.urlencode({
            "action": "query", "generator": "allimages", "gaiprefix": prefix, "gailimit": "100",
            "prop": "imageinfo", "iiprop": "url|size|mime", "format": "json", "formatversion": "2"})
        try:
            _, raw = client.get(url)
            data = json.loads(raw.decode("utf-8"))
        except Exception as err:  # keep going: log-only
            log("  fandom %r: %s" % (prefix, err))
            continue
        for page in data.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            found.append({"source": "fandom", "title": page.get("title"), "url": info.get("url"),
                          "width": info.get("width"), "height": info.get("height"), "mime": info.get("mime")})
    return found


def extract_images(base, body):
    text = body.decode("utf-8", "replace")
    urls = set()
    for m in re.finditer(r'(?:src|data-src|href|content)\s*=\s*"([^"]+)"', text):
        urls.add(m.group(1))
    for m in re.finditer(r'srcset\s*=\s*"([^"]+)"', text):
        urls.update(part.strip().split(" ")[0] for part in m.group(1).split(","))
    for m in re.finditer(r"url\(\s*['\"]?([^'\")]+)", text):
        urls.add(m.group(1))
    links = set(re.findall(r'href\s*=\s*"([^"]+)"', text))
    absolute = lambda u: urllib.parse.urljoin(base, html.unescape(u))
    return {absolute(u) for u in urls if IMG_EXT.search(u)}, {absolute(u) for u in links}


def official(client, names, max_pages):
    queue, seen, images = list(OFFICIAL_SEEDS), set(), set()
    while queue and len(seen) < max_pages:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            final, body = client.get(url)
        except Exception as err:
            log("  official %s: %s" % (url, err))
            continue
        imgs, links = extract_images(final, body)
        images |= imgs
        host = urllib.parse.urlparse(final).netloc
        for link in sorted(links):
            parsed = urllib.parse.urlparse(link)
            if parsed.netloc == host and "character" in parsed.path.lower() and link not in seen:
                queue.append(link.split("#")[0])
        log("  official page %s: %d images, %d queued" % (final, len(imgs), len(queue)))
    per = {}
    for name in names:
        ks = keys_for(name)
        per[name] = sorted({u for u in images if any(k and k in norm(urllib.parse.urlparse(u).path) for k in ks)})
    return per, sorted(images)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--names", default=",".join(DEFAULT_NAMES))
    ap.add_argument("--out", default="art-discovery.json")
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--max-pages", type=int, default=60)
    args = ap.parse_args()
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    client = Polite(args.delay)
    report = {"fandom": {}, "official": {}, "officialAllImages": []}
    log("== Tekken Fandom ==")
    for name in names:
        hits = [h for h in fandom(client, name) if h.get("url")]
        uniq = {h["url"]: h for h in hits}.values()
        report["fandom"][name] = sorted(uniq, key=lambda h: -(h.get("height") or 0))
        log("%s: %d files" % (name, len(report["fandom"][name])))
        for h in report["fandom"][name][:15]:
            log("    %s %sx%s %s" % (h["title"], h.get("width"), h.get("height"), h["url"]))
    log("== Official site ==")
    per, every = official(client, names, args.max_pages)
    report["official"], report["officialAllImages"] = per, every
    for name in names:
        log("%s: %d images" % (name, len(per[name])))
        for u in per[name][:15]:
            log("    " + u)
    log("official images seen in total: %d (sample below)" % len(every))
    for u in every[:40]:
        log("    " + u)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    log("wrote " + args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

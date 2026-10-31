#!/usr/bin/env python3
"""
make_zanshin_media_pack.py - build a ZANSHIN media pack from Wavu Wiki.

Downloads character icons and portraits for the Tekken 8 roster and the move
clips for your main character (Yoshimitsu by default), and optionally the
punishable-move clips of opponents. Writes them, with a manifest.json, into a
zip that ZANSHIN's "Import media pack" reads.

Run it on your own computer (Windows, macOS or Linux, Python 3.8 or newer):

    python make_zanshin_media_pack.py
    python make_zanshin_media_pack.py --opponents all
    python make_zanshin_media_pack.py --opponents "Kazuya,Jin,Devil Jin" --opponent-moves all

The deploy pipeline runs it with --site-dir public to publish the media with
the site itself (public/media/manifest.json plus content-addressed files);
the app then adds that media to every device on its own (release 1.2.0).

Standard library only. If Pillow is installed (pip install pillow), portraits
are shrunk to 1080 px wide WebP, which cuts the pack by about 50 MB; without
it the original PNGs are packed and the app shrinks them on import.

Downloads are cached in .zanshin-media-cache next to where you run it, so a
second run after a patch only fetches files that changed. Requests go one at
a time, two per second at most, and back off when the wiki asks.

The files are Bandai Namco's game art and recordings as hosted on Wavu Wiki.
The pack is for your own use in your own app.
"""

import argparse
import datetime as dt
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.2"
DEFAULT_API = "https://wavu.wiki/w/api.php"
USER_AGENT = "ZANSHIN-media-pack/" + VERSION + " (personal training app; one user)"
CREDIT = "© Bandai Namco Entertainment Inc., via Wavu Wiki"
RETRY_CODES = {429, 500, 502, 503, 504}
PUNISHABLE_AT = -10


def log(msg):
    print(msg, flush=True)


class Fetcher:
    """Polite HTTP client: one request at a time, a minimum gap, backoff on errors."""

    def __init__(self, api, delay):
        self.api = api
        self.delay = delay
        self.last = 0.0
        self.requests = 0

    def _wait(self):
        gap = time.monotonic() - self.last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self.last = time.monotonic()

    def fetch(self, url, data=None, tries=6):
        for attempt in range(tries):
            self._wait()
            self.requests += 1
            req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    return resp.read()
            except urllib.error.HTTPError as err:
                if err.code in RETRY_CODES and attempt < tries - 1:
                    wait = 2 ** (attempt + 1)
                    log("  HTTP %d, waiting %ds and retrying" % (err.code, wait))
                    time.sleep(wait)
                    continue
                raise
            except urllib.error.URLError as err:
                if attempt < tries - 1:
                    wait = 2 ** (attempt + 1)
                    log("  network error (%s), waiting %ds and retrying" % (err.reason, wait))
                    time.sleep(wait)
                    continue
                raise

    def api_get(self, params):
        query = urllib.parse.urlencode(dict(params, format="json"))
        return self._json(self.fetch(self.api + "?" + query))

    def api_post(self, params):
        body = urllib.parse.urlencode(dict(params, format="json")).encode("utf-8")
        return self._json(self.fetch(self.api, data=body))

    @staticmethod
    def _json(raw):
        data = json.loads(raw.decode("utf-8"))
        if isinstance(data, dict) and "error" in data:
            err = data["error"]
            raise RuntimeError("Wavu API error: %s" % (err.get("info") or err))
        return data


def cargo_rows(fetcher, fields, where=None, group_by=None, page=500):
    """Query the Cargo Move table, paging until a short page comes back."""
    rows, offset = [], 0
    while True:
        params = {"action": "cargoquery", "tables": "Move", "fields": fields,
                  "limit": str(page), "offset": str(offset)}
        if where:
            params["where"] = where
        if group_by:
            params["group_by"] = group_by
        data = fetcher.api_get(params)
        batch = []
        for item in data.get("cargoquery", []):
            row = item.get("title", {})
            batch.append({k: html.unescape(v) if isinstance(v, str) else v for k, v in row.items()})
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page


def read_roster(fetcher):
    rows = cargo_rows(fetcher, "Move._pageName=page", group_by="Move._pageName")
    names = set()
    for row in rows:
        page = row.get("page") or ""
        if page.endswith(" movelist") and page != "Generic movelist":
            names.add(page[: -len(" movelist")])
    return sorted(names)


def moves_with_video(fetcher, name):
    if "'" in name:
        raise ValueError("unexpected quote in character name: %r" % name)
    where = "Move._pageName='%s movelist' AND Move.video IS NOT NULL" % name
    rows = cargo_rows(fetcher, "Move.id,Move.video,Move.block", where=where)
    return [r for r in rows if r.get("id") and r.get("video")]


def first_number(value):
    if not value:
        return None
    match = re.search(r"[+-]?\d+", value.replace("−", "-"))
    return int(match.group()) if match else None


def is_punishable(block):
    number = first_number(block)
    return number is not None and number <= PUNISHABLE_AT


def file_title(raw):
    raw = raw.strip()
    return raw if raw.lower().startswith("file:") else "File:" + raw


def resolve_files(fetcher, titles):
    """Map each File: title to its imageinfo (url, size, mime, sha1), or None if missing."""
    result = {}
    unique = list(dict.fromkeys(titles))
    for start in range(0, len(unique), 50):
        chunk = unique[start:start + 50]
        data = fetcher.api_post({"action": "query", "prop": "imageinfo",
                                 "iiprop": "url|size|mime|sha1", "titles": "|".join(chunk),
                                 "formatversion": "2"})
        query = data.get("query", {})
        normalized = {n["from"]: n["to"] for n in query.get("normalized", [])}
        pages = {p.get("title"): p for p in query.get("pages", [])}
        for title in chunk:
            page = pages.get(normalized.get(title, title))
            if page and not page.get("missing") and not page.get("invalid") and page.get("imageinfo"):
                info = dict(page["imageinfo"][0])
                info["title"] = page["title"]
                result[title] = info
            else:
                result[title] = None
    return result


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "item"


def cached_download(fetcher, info, cache_dir):
    """Return file bytes, downloading only when the cached copy's sha1 differs."""
    expected = (info.get("sha1") or "").lower()
    suffix = Path(urllib.parse.urlparse(info["url"]).path).suffix or ".bin"
    path = cache_dir / (slug(info["title"]) + suffix)
    if path.exists() and expected:
        data = path.read_bytes()
        if hashlib.sha1(data).hexdigest() == expected:
            return data, False
    data = fetcher.fetch(info["url"])
    if expected and hashlib.sha1(data).hexdigest() != expected:
        raise RuntimeError("checksum mismatch for %s" % info["title"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data, True


def shrink_portrait(data, max_width):
    """Return (webp_bytes, width, height), or None when Pillow is not installed."""
    try:
        from PIL import Image
    except ImportError:
        return None
    image = Image.open(io.BytesIO(data))
    image.load()
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    if image.width > max_width:
        resample = getattr(Image, "Resampling", Image).LANCZOS
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), resample)
    out = io.BytesIO()
    image.save(out, "WEBP", quality=82, method=6)
    return out.getvalue(), image.width, image.height


def split_pack(items, payloads, max_bytes):
    """Split one pack into parts of at most max_bytes of files each (0 = never).

    Items that share a file stay in the same part, and the order is kept. A
    single file larger than the limit gets a part of its own. Phones read a
    whole zip into memory to import it, so smaller parts import more reliably.
    """
    groups, order = {}, []
    for item in items:
        if item["file"] not in groups:
            groups[item["file"]] = []
            order.append(item["file"])
        groups[item["file"]].append(item)
    parts, size = [[]], 0
    for arc in order:
        n = len(payloads[arc])
        if max_bytes > 0 and parts[-1] and size + n > max_bytes:
            parts.append([])
            size = 0
        parts[-1].append(arc)
        size += n
    return [([item for arc in arcs for item in groups[arc]], {arc: payloads[arc] for arc in arcs})
            for arcs in parts]


def pack_id(items):
    """A stable id for a set of items: changes whenever any file changes."""
    digest = hashlib.sha256()
    for item in sorted(items, key=lambda it: (it["kind"], it["subjectKey"])):
        digest.update(("%s|%s|%s\n" % (item["kind"], item["subjectKey"], item["sha256"])).encode("utf-8"))
    return "sha256-" + digest.hexdigest()[:24]


def write_site(site_dir, items, payloads, misses, created):
    """Write the pack unzipped under <site_dir>/media with content-addressed
    file names (<sha256 prefix>-<slug>.<ext>), so the files can be cached
    forever and a refreshed pack never serves old bytes under a new name.
    Returns the number of files written. Anything already under
    <site_dir>/media that is not part of this pack is removed first."""
    media_dir = Path(site_dir) / "media"
    if media_dir.exists():
        for old in sorted(media_dir.rglob("*"), reverse=True):
            if old.is_file():
                old.unlink()
            elif old.is_dir():
                old.rmdir()
    media_dir.mkdir(parents=True, exist_ok=True)
    renamed = {}
    site_items = []
    for item in items:
        old_name = item["file"]
        if old_name not in renamed:
            base = slug(item["subjectKey"].split(":", 1)[1])
            suffix = Path(old_name).suffix
            renamed[old_name] = "media/%s/%s-%s%s" % (item["kind"], item["sha256"][:16], base, suffix)
            target = Path(site_dir) / renamed[old_name]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payloads[old_name])
        site_items.append(dict(item, file=renamed[old_name]))
    manifest = {
        "format": "zanshin-media-pack",
        "version": 1,
        "createdAt": created,
        "generator": "make_zanshin_media_pack.py " + VERSION,
        "source": "https://wavu.wiki",
        "packId": pack_id(site_items),
        "items": site_items,
        "misses": misses,
    }
    (media_dir / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    return len(renamed)


def write_pack(path, items, payloads, misses, created):
    manifest = {
        "format": "zanshin-media-pack",
        "version": 1,
        "createdAt": created,
        "generator": "make_zanshin_media_pack.py " + VERSION,
        "source": "https://wavu.wiki",
        "packId": pack_id(items),
        "items": items,
        "misses": misses,
    }
    with zipfile.ZipFile(path, "w") as pack:
        pack.writestr("manifest.json", json.dumps(manifest, indent=1, ensure_ascii=False),
                      compress_type=zipfile.ZIP_DEFLATED)
        for name, payload in payloads.items():
            pack.writestr(name, payload, compress_type=zipfile.ZIP_STORED)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Build a ZANSHIN media pack (icons, portraits, move clips) from Wavu Wiki.")
    parser.add_argument("--character", default="Yoshimitsu",
                        help="main character whose every clip is packed (default: Yoshimitsu)")
    parser.add_argument("--opponents", default="none",
                        help="'none' (default), 'all', or a comma-separated list such as 'Kazuya,Jin'")
    parser.add_argument("--opponent-moves", choices=["punishable", "all"], default="punishable",
                        help="opponent clips to pack: punishable on block (-10 or worse, default) or all")
    parser.add_argument("--no-icons", action="store_true", help="skip character icons")
    parser.add_argument("--no-portraits", action="store_true", help="skip character portraits")
    parser.add_argument("--no-clips", action="store_true", help="skip the main character's clips")
    parser.add_argument("--keep-png", action="store_true",
                        help="pack original portrait PNGs even if Pillow is installed")
    parser.add_argument("--portrait-width", type=int, default=1080, help="max portrait width in px")
    parser.add_argument("--max-zip-mb", type=float, default=100,
                        help="split a pack into parts of at most this many MB (default 100; 0 = one zip)")
    parser.add_argument("--out-dir", default=".", help="folder for the zip files (default: here)")
    parser.add_argument("--site-dir", default=None,
                        help="write one unzipped pack under <SITE-DIR>/media for the site to serve, instead of zips")
    parser.add_argument("--cache-dir", default=".zanshin-media-cache", help="download cache folder")
    parser.add_argument("--delay", type=float, default=0.5,
                        help="minimum seconds between requests (default 0.5)")
    parser.add_argument("--api", default=DEFAULT_API, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    fetcher = Fetcher(args.api, max(args.delay, 0.0))
    cache_dir = Path(args.cache_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    created = now.isoformat().replace("+00:00", "Z")
    stamp = now.strftime("%Y%m%d")

    log("Reading the Tekken 8 roster from Wavu Wiki...")
    roster = read_roster(fetcher)
    if args.character not in roster:
        log("'%s' is not in the roster. Names look like: %s" % (args.character, ", ".join(roster)))
        return 2
    log("  %d characters" % len(roster))

    if args.opponents.strip().lower() == "none":
        opponents = []
    elif args.opponents.strip().lower() == "all":
        opponents = [n for n in roster if n != args.character]
    else:
        opponents = [n.strip() for n in args.opponents.split(",") if n.strip()]
        unknown = [n for n in opponents if n not in roster]
        if unknown:
            log("Unknown opponent names: %s" % ", ".join(unknown))
            log("Use names exactly as listed: %s" % ", ".join(roster))
            return 2

    # wanted: (pack, kind, subjectKey, title, folder)
    wanted = []
    for name in roster:
        if not args.no_icons:
            wanted.append(("core", "character-icon", "character:" + name, "File:%sT8.png" % name, "icons"))
        if not args.no_portraits:
            wanted.append(("core", "character-portrait", "character:" + name,
                           "File:%s portrait.png" % name, "portraits"))

    if not args.no_clips:
        log("Listing %s's moves that have clips..." % args.character)
        rows = moves_with_video(fetcher, args.character)
        log("  %d clips" % len(rows))
        for row in rows:
            wanted.append(("core", "move-clip", "move:" + row["id"], file_title(row["video"]), "clips"))

    for name in opponents:
        rows = moves_with_video(fetcher, name)
        if args.opponent_moves == "punishable":
            rows = [r for r in rows if is_punishable(r.get("block"))]
        log("  %s: %d clips" % (name, len(rows)))
        for row in rows:
            wanted.append(("opponents", "move-clip", "move:" + row["id"], file_title(row["video"]),
                           "clips/" + slug(name)))

    log("Resolving %d files..." % len({w[3] for w in wanted}))
    infos = resolve_files(fetcher, [w[3] for w in wanted])

    packs = {"core": {"items": [], "payloads": {}, "misses": []},
             "opponents": {"items": [], "payloads": {}, "misses": []}}
    arc_names = {}
    downloaded = reused = 0
    shrink_note = False
    for index, (pack_id, kind, subject, title, folder) in enumerate(wanted, 1):
        pack = packs[pack_id]
        info = infos.get(title)
        if info is None:
            pack["misses"].append({"kind": kind, "subjectKey": subject, "title": title})
            continue
        try:
            data, fresh = cached_download(fetcher, info, cache_dir)
        except Exception as err:  # keep going; the miss is recorded
            log("  failed: %s (%s)" % (title, err))
            pack["misses"].append({"kind": kind, "subjectKey": subject, "title": title, "error": str(err)})
            continue
        downloaded += int(fresh)
        reused += int(not fresh)
        mime = info.get("mime") or "application/octet-stream"
        width, height = info.get("width"), info.get("height")
        suffix = Path(urllib.parse.urlparse(info["url"]).path).suffix.lower() or ".bin"

        if kind == "character-portrait" and not args.keep_png:
            shrunk = shrink_portrait(data, args.portrait_width)
            if shrunk is None:
                shrink_note = True
            else:
                data, width, height = shrunk
                mime, suffix = "image/webp", ".webp"

        key = (pack_id, title, suffix)
        if key not in arc_names:
            base = slug(subject.split(":", 1)[1])
            arc_names[key] = "%s/%04d-%s%s" % (folder, index, base, suffix)
            pack["payloads"][arc_names[key]] = data
        arc = arc_names[key]
        pack["items"].append({
            "file": arc,
            "kind": kind,
            "subjectKey": subject,
            "mime": mime,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "width": width,
            "height": height,
            "source": "wavu",
            "sourcePage": info.get("descriptionurl"),
            "sourceSha1": info.get("sha1"),
            "credit": CREDIT,
        })
        if (downloaded + reused) % 25 == 0:
            log("  %d files ready" % (downloaded + reused))

    written = []
    if args.site_dir:
        items = packs["core"]["items"] + packs["opponents"]["items"]
        payloads = dict(packs["core"]["payloads"])
        payloads.update(packs["opponents"]["payloads"])
        misses = packs["core"]["misses"] + packs["opponents"]["misses"]
        if items:
            count = write_site(args.site_dir, items, payloads, misses, created)
            written.append((Path(args.site_dir) / "media" / "manifest.json", {"items": items, "misses": misses}))
            log("Wrote %d files under %s" % (count, Path(args.site_dir) / "media"))
    else:
        max_bytes = int(max(args.max_zip_mb, 0) * 1e6)
        for pack_key, label in (("core", ""), ("opponents", "-opponents")):
            pack = packs[pack_key]
            if not pack["items"]:
                continue
            parts = split_pack(pack["items"], pack["payloads"], max_bytes)
            for number, (items, payloads) in enumerate(parts, 1):
                part = "" if len(parts) == 1 else "-part%d" % number
                misses = pack["misses"] if number == 1 else []
                path = out_dir / ("zanshin-media-pack%s-%s%s.zip" % (label, stamp, part))
                write_pack(path, items, payloads, misses, created)
                written.append((path, {"items": items, "misses": misses}))

    log("")
    log("Done. %d files downloaded, %d reused from the cache, %d requests." %
        (downloaded, reused, fetcher.requests))
    for path, pack in written:
        counts = {}
        for item in pack["items"]:
            counts[item["kind"]] = counts.get(item["kind"], 0) + 1
        if path.name == "manifest.json":
            size_mb = sum(f.stat().st_size for f in path.parent.rglob("*") if f.is_file()) / 1e6
        else:
            size_mb = path.stat().st_size / 1e6
        summary = ", ".join("%d %s" % (n, k) for k, n in sorted(counts.items()))
        log("  %s  %.1f MB  (%s)" % (path, size_mb, summary))
        for miss in pack["misses"]:
            log("    missing: %s  %s" % (miss["subjectKey"], miss["title"]))
    if shrink_note:
        log("Pillow is not installed, so portraits stay full-size PNGs. "
            "Run 'pip install pillow' and re-run to shrink them; the cache makes it quick.")
    if not written:
        log("Nothing was packed.")
        return 1
    if args.site_dir:
        log("Deploy the site; the app adds this media to each device on its own.")
    else:
        log("Import each zip in ZANSHIN: Settings > Images and clips > Import media pack.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("Stopped. Files downloaded so far stay in the cache; run again to continue.")
        sys.exit(130)
    except urllib.error.HTTPError as err:
        log("Wavu Wiki answered HTTP %d for %s." % (err.code, err.url))
        log("Wait a few minutes and run again; the cache keeps what already downloaded.")
        sys.exit(1)
    except (urllib.error.URLError, RuntimeError) as err:
        log("Could not finish: %s" % err)
        log("Check the connection and run again; the cache keeps what already downloaded.")
        sys.exit(1)

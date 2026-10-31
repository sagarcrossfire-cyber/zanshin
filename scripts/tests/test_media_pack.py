"""Offline test of make_zanshin_media_pack.py against a mock Wavu API."""
import hashlib, io, json, os, subprocess, sys, threading, urllib.parse, zipfile, shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image

import traceback

def _main():
    HERE = Path(__file__).parent
    SCRIPT = HERE.parent / "make_zanshin_media_pack.py"
    import tempfile
    WORK = Path(tempfile.mkdtemp(prefix="zanshin-media-test-"))
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir()

    def png(w, h, color):
        b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, "PNG"); return b.getvalue()

    FILES = {  # normalized title -> (bytes, mime, w, h)
        "File:AlisaT8.png": (png(144, 176, "red"), "image/png", 144, 176),
        "File:Devil JinT8.png": (png(144, 176, "blue"), "image/png", 144, 176),
        "File:YoshimitsuT8.png": (png(144, 176, "green"), "image/png", 144, 176),
        # Kazuya icon deliberately missing
        "File:Yoshimitsu portrait.png": (png(1601, 1533, "gray"), "image/png", 1601, 1533),
        "File:Devil Jin portrait.png": (png(1500, 1013, "black"), "image/png", 1500, 1013),
        "File:Kazuya portrait.png": (png(1400, 2400, "white"), "image/png", 1400, 2400),
        # Alisa portrait deliberately missing
        "File:T8-p2-yoshimitsu-1,1.mp4": (b"clip-1-1" * 1000, "video/mp4", 640, 360),
        "File:T8-p2-yoshimitsu-2,1.mp4": (b"clip-2-1" * 1000, "video/mp4", 640, 360),
        # yoshimitsu-1+2 clip deliberately missing
        "File:T8-p2-devil jin-1,1,2.mp4": (b"dj-112" * 1000, "video/mp4", 640, 360),
        "File:T8-p2-devil jin-1,2,4.mp4": (b"dj-124" * 1000, "video/mp4", 640, 360),
    }
    CARGO = {
        "Yoshimitsu movelist": [
            {"id": "Yoshimitsu-1,1", "video": "File:t8-p2-yoshimitsu-1,1.mp4", "block": "-9"},
            {"id": "Yoshimitsu-1+2", "video": "File:t8-p2-yoshimitsu-1+2.mp4", "block": "-12"},
            {"id": "Yoshimitsu-2,1", "video": "File:t8-p2-yoshimitsu-2,1.mp4", "block": None},
        ],
        "Devil Jin movelist": [
            {"id": "Devil Jin-1,1,2", "video": "File:t8-p2-devil jin-1,1,2.mp4", "block": "-17"},
            {"id": "Devil Jin-1,2", "video": "File:t8-p2-devil jin-1,2.mp4", "block": "-3"},
            {"id": "Devil Jin-1,2,4", "video": "File:t8-p2-devil jin-1,2,4.mp4", "block": "-10"},
            {"id": "Devil Jin-d+4", "video": "File:t8-p2-devil jin-d+4.mp4", "block": "-9~-8"},
            {"id": "Devil Jin-f+2", "video": "File:t8-p2-devil jin-f+2.mp4", "block": "+5g"},
        ],
    }
    PAGES = ["Alisa movelist", "Devil Jin movelist", "Generic movelist", "Heat", "Kazuya movelist", "Yoshimitsu movelist"]
    STATS = {"downloads": 0, "api": 0}

    def normalize(t):
        head, _, name = t.partition(":")
        name = name.replace("_", " ")
        return "File:" + name[:1].upper() + name[1:]

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, obj=None, raw=None, ctype="application/json"):
            body = raw if raw is not None else json.dumps(obj).encode()
            self.send_response(200); self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/w/api.php":
                STATS["api"] += 1
                q = dict(urllib.parse.parse_qsl(u.query))
                assert q["action"] == "cargoquery" and q["format"] == "json", q
                assert "User-Agent" in self.headers and "ZANSHIN" in self.headers["User-Agent"]
                limit, offset = int(q["limit"]), int(q["offset"])
                if "group_by" in q:
                    rows = [{"page": p} for p in PAGES]
                else:
                    page = q["where"].split("'")[1][:-len(" movelist")] + " movelist"
                    rows = [{k: v for k, v in r.items() if v is not None} for r in CARGO.get(page, [])]
                    assert "Move.video IS NOT NULL" in q["where"]
                rows = rows[offset:offset + limit]
                return self._send({"cargoquery": [{"title": r} for r in rows]})
            if u.path.startswith("/w/images/"):
                STATS["downloads"] += 1
                title = urllib.parse.unquote(u.path[len("/w/images/"):])
                return self._send(raw=FILES[title][0], ctype=FILES[title][1])
            self.send_error(404)
        def do_POST(self):
            STATS["api"] += 1
            n = int(self.headers["Content-Length"]); q = dict(urllib.parse.parse_qsl(self.rfile.read(n).decode()))
            assert q["action"] == "query" and q["prop"] == "imageinfo" and q["formatversion"] == "2", q
            titles = q["titles"].split("|"); assert len(titles) <= 50
            normalized, pages = [], []
            for t in titles:
                nt = normalize(t)
                if nt != t: normalized.append({"from": t, "to": nt})
                if nt in FILES:
                    data, mime, w, h = FILES[nt]
                    pages.append({"title": nt, "imageinfo": [{
                        "url": "http://127.0.0.1:%d/w/images/%s" % (PORT, urllib.parse.quote(nt)),
                        "descriptionurl": "https://wavu.wiki/t/" + nt.replace(" ", "_"),
                        "size": len(data), "width": w, "height": h, "mime": mime,
                        "sha1": hashlib.sha1(data).hexdigest()}]})
                else:
                    pages.append({"title": nt, "missing": True})
            self._send({"batchcomplete": True, "query": {"normalized": normalized, "pages": pages}})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H); PORT = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    API = "http://127.0.0.1:%d/w/api.php" % PORT

    def run(*extra, env=None):
        cmd = [sys.executable, "-I", str(SCRIPT), "--api", API, "--delay", "0",
               "--out-dir", str(WORK / "out"), "--cache-dir", str(WORK / "cache"), *extra]
        p = subprocess.run(cmd, capture_output=True, text=True, env=env)
        print(p.stdout); print(p.stderr, file=sys.stderr)
        return p.returncode

    def check_pack(path):
        with zipfile.ZipFile(path) as z:
            m = json.loads(z.read("manifest.json"))
            assert m["format"] == "zanshin-media-pack" and m["version"] == 1
            names = set(z.namelist())
            for it in m["items"]:
                data = z.read(it["file"])
                assert hashlib.sha256(data).hexdigest() == it["sha256"], it
                assert len(data) == it["bytes"]
                assert it["subjectKey"].split(":")[0] in ("character", "move")
            return m, names

    # Run 1: core + Devil Jin opponents
    rc = run("--opponents", "Devil Jin")
    assert rc == 0, rc
    packs = sorted((WORK / "out").glob("*.zip")); print([p.name for p in packs])
    assert len(packs) == 2
    core = [p for p in packs if "opponents" not in p.name][0]; opp = [p for p in packs if "opponents" in p.name][0]
    m, names = check_pack(core)
    kinds = {}
    for it in m["items"]: kinds[it["kind"]] = kinds.get(it["kind"], 0) + 1
    print("core kinds", kinds, "misses", [x["title"] for x in m["misses"]])
    assert kinds == {"character-icon": 3, "character-portrait": 3, "move-clip": 2}, kinds
    assert {x["title"] for x in m["misses"]} == {"File:KazuyaT8.png", "File:Alisa portrait.png", "File:t8-p2-yoshimitsu-1+2.mp4"}
    por = [it for it in m["items"] if it["kind"] == "character-portrait"]
    assert all(it["mime"] == "image/webp" and it["width"] <= 1080 for it in por), por
    kz = [it for it in por if it["subjectKey"] == "character:Kazuya"][0]
    assert kz["width"] == 1080 and kz["height"] == round(2400 * 1080 / 1400), kz
    clips = {it["subjectKey"] for it in m["items"] if it["kind"] == "move-clip"}
    assert clips == {"move:Yoshimitsu-1,1", "move:Yoshimitsu-2,1"}, clips
    mo, _ = check_pack(opp)
    oclips = {it["subjectKey"] for it in mo["items"]}
    print("opponent clips", oclips, "misses", [x["title"] for x in mo["misses"]])
    assert oclips == {"move:Devil Jin-1,1,2", "move:Devil Jin-1,2,4"}, oclips
    assert [x["title"] for x in mo["misses"]] == []
    first_downloads = STATS["downloads"]; print("downloads run1", first_downloads)

    # Run 2: cache reuse, no new downloads
    rc = run("--opponents", "Devil Jin"); assert rc == 0
    print("downloads after run2", STATS["downloads"]); assert STATS["downloads"] == first_downloads

    # Run 3: --keep-png and no opponents
    shutil.rmtree(WORK / "out")
    rc = run("--keep-png"); assert rc == 0
    packs = list((WORK / "out").glob("*.zip")); assert len(packs) == 1
    m, _ = check_pack(packs[0])
    assert all(it["mime"] == "image/png" for it in m["items"] if it["kind"] == "character-portrait")

    # Run 4: Pillow unavailable -> PNG kept, note printed
    shutil.rmtree(WORK / "out")
    shim = WORK / "shim"; (shim / "PIL").mkdir(parents=True)
    (shim / "PIL" / "__init__.py").write_text("raise ImportError('no pillow')\n")
    cmd = [sys.executable, "-c", "import sys; sys.path.insert(0, %r); sys.argv=%r; exec(open(%r).read())" % (
        str(shim), ["x", "--api", API, "--delay", "0", "--out-dir", str(WORK / "out"), "--cache-dir", str(WORK / "cache")], str(SCRIPT))]
    p = subprocess.run(cmd, capture_output=True, text=True); print(p.stdout[-400:], p.stderr[-400:])
    assert "Pillow is not installed" in p.stdout
    m, _ = check_pack(list((WORK / "out").glob("*.zip"))[0])
    assert all(it["mime"] == "image/png" for it in m["items"] if it["kind"] == "character-portrait")

    # Run 5: split into parts by size; every part is a valid pack, items keep order,
    # misses go only in part 1, and together the parts hold exactly one unsplit pack.
    shutil.rmtree(WORK / "out")
    rc = run("--keep-png"); assert rc == 0
    whole, _ = check_pack(list((WORK / "out").glob("*.zip"))[0])
    shutil.rmtree(WORK / "out")
    rc = run("--keep-png", "--max-zip-mb", "0.00001"); assert rc == 0
    parts = sorted((WORK / "out").glob("*-part*.zip"), key=lambda p: int(p.stem.rsplit("part", 1)[1]))
    assert len(parts) >= 2 and len(parts) == len(list((WORK / "out").glob("*.zip"))), parts
    joined, missing_in = [], []
    for i, part in enumerate(parts):
        m, _ = check_pack(part)
        joined += m["items"]
        if m["misses"]: missing_in.append(i)
    assert missing_in == [0], missing_in
    assert [it["subjectKey"] for it in joined] == [it["subjectKey"] for it in whole["items"]]
    # Unit: items sharing a file stay together; one oversized file gets its own part.
    items = [{"file": "a"}, {"file": "b"}, {"file": "a"}, {"file": "c"}]
    parts_ = mz_split = None
    sys.path.insert(0, str(SCRIPT.parent))
    import make_zanshin_media_pack as mz
    got = mz.split_pack(items, {"a": b"x" * 5, "b": b"y" * 50, "c": b"z" * 5}, 10)
    assert [[it["file"] for it in p_items] for p_items, _ in got] == [["a", "a"], ["b"], ["c"]], got
    assert len(mz.split_pack(items, {"a": b"x", "b": b"y", "c": b"z"}, 0)) == 1

    # Run 6: --site-dir writes content-addressed files plus a manifest with a packId;
    # re-running replaces the folder; the id changes only when bytes change.
    site = WORK / "site"
    rc = run("--keep-png", "--site-dir", str(site)); assert rc == 0
    man = json.loads((site / "media" / "manifest.json").read_text(encoding="utf-8"))
    assert man["format"] == "zanshin-media-pack" and man["packId"].startswith("sha256-"), man["packId"]
    for it in man["items"]:
        f = site / it["file"]
        assert it["file"].startswith("media/%s/%s-" % (it["kind"], it["sha256"][:16])), it["file"]
        data = f.read_bytes(); assert hashlib.sha256(data).hexdigest() == it["sha256"] and len(data) == it["bytes"]
    (site / "media" / "stale.bin").write_bytes(b"old")
    first_id = man["packId"]
    rc = run("--keep-png", "--site-dir", str(site)); assert rc == 0
    assert not (site / "media" / "stale.bin").exists()
    assert json.loads((site / "media" / "manifest.json").read_text(encoding="utf-8"))["packId"] == first_id
    zip_id = json.loads(zipfile.ZipFile(list((WORK / "out").glob("*part1.zip"))[0]).read("manifest.json"))["packId"]
    assert zip_id.startswith("sha256-")

    # Run 7: unknown names
    assert run("--opponents", "Nobody") == 2
    assert run("--character", "Nobody") == 2

    # Unit: paging and punishable parsing
    sys.path.insert(0, str(SCRIPT.parent))
    import make_zanshin_media_pack as mz
    f = mz.Fetcher(API, 0)
    rows = mz.cargo_rows(f, "Move.id,Move.video,Move.block", where="Move._pageName='Devil Jin movelist' AND Move.video IS NOT NULL", page=2)
    assert len(rows) == 5, rows
    assert [mz.is_punishable(b) for b in ["-17", "-3", "-10", "-9~-8", "+5g", None, "−12", "-14c"]] == [True, False, True, False, False, False, True, True]
    assert mz.file_title("t8-p2-x.mp4") == "File:t8-p2-x.mp4" and mz.file_title("File:a.png") == "File:a.png"
    print("ALL TESTS PASSED")



if __name__ == "__main__":
    try:
        _main()
    except BaseException:
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        print("::error title=media pack script self-test failed::" + tb.strip().splitlines()[-1])
        sys.exit(1)
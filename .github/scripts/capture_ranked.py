#!/usr/bin/env python3
"""One-off, polite capture of Wavu Wank responses as test fixtures for ZANSHIN M2.

One request at a time, at least 3 s apart, with a descriptive User-Agent. Writes the raw
(decompressed) responses and a summary into tests/fixtures/ranked/. Temporary: this file
lives only on the short-lived fixtures/ranked branch.
"""
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = "https://wank.wavu.wiki"
UA = ("ZANSHIN-fixtures/1.0 (+https://github.com/sagarcrossfire-cyber/zanshin; "
      "personal Tekken 8 training app, one-off test fixture capture, 3 requests)")
OUT = os.path.join("tests", "fixtures", "ranked")
GAP_S = 3.0
YOSHIMITSU = 3

summary = {"startedAt": int(time.time()), "userAgent": UA, "requests": [], "errors": []}
_last = [0.0]


def get(path):
    wait = GAP_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    url = BASE + path
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Encoding": "gzip",
        "Accept": "application/json, text/html;q=0.9",
    })
    rec = {"url": url, "at": int(time.time())}
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            rec["status"] = resp.status
            headers = {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as err:
        raw = err.read() or b""
        rec["status"] = err.code
        headers = {k.lower(): v for k, v in (err.headers or {}).items()}
    except Exception as err:  # network, TLS, timeout
        rec["status"] = None
        rec["error"] = repr(err)
        summary["requests"].append(rec)
        _last[0] = time.time()
        return None, rec
    _last[0] = time.time()
    if headers.get("content-encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
        except Exception as err:
            rec["gunzipError"] = repr(err)
    rec["ms"] = int((time.time() - started) * 1000)
    rec["bytes"] = len(raw)
    rec["headers"] = {k: v for k, v in headers.items() if k in (
        "content-type", "content-encoding", "cache-control", "retry-after", "x-ratelimit-limit",
        "x-ratelimit-remaining", "x-ratelimit-reset", "server", "date", "age", "vary",
        "access-control-allow-origin")}
    summary["requests"].append(rec)
    return raw, rec


def save(name, data):
    with open(os.path.join(OUT, name), "wb") as fh:
        fh.write(data)


def main():
    os.makedirs(OUT, exist_ok=True)
    before = int(time.time()) - 2 * 3600
    summary["before"] = before
    raw, rec = get("/api/replays?before=%d" % before)
    if raw is None or rec.get("status") != 200:
        summary["errors"].append("replays window failed")
        if raw:
            save("replays-error.txt", raw[:20000])
        return
    save("replays-window.json", raw)
    try:
        data = json.loads(raw)
    except Exception as err:
        summary["errors"].append("replays not JSON: %r" % err)
        return
    rows = data if isinstance(data, list) else data.get("replays") or data.get("data") or []
    summary["replayCount"] = len(rows)
    summary["replayKeys"] = sorted(rows[0].keys()) if rows else []
    summary["battleTypes"] = {}
    for r in rows:
        bt = str(r.get("battle_type"))
        summary["battleTypes"][bt] = summary["battleTypes"].get(bt, 0) + 1
    pick = None
    for r in rows:
        if r.get("battle_type") != 2:
            continue
        for side in ("p1", "p2"):
            if r.get(side + "_chara_id") == YOSHIMITSU and r.get(side + "_polaris_id"):
                pick = (r[side + "_polaris_id"], side, r)
                break
        if pick:
            break
    if not pick:
        for r in rows:
            if r.get("battle_type") == 2 and r.get("p1_polaris_id"):
                pick = (r["p1_polaris_id"], "p1", r)
                break
    if not pick:
        summary["errors"].append("no ranked player in window")
        return
    pid, side, row = pick
    summary["player"] = {"polarisId": pid, "side": side, "charaId": row.get(side + "_chara_id"),
                         "battleAt": row.get("battle_at"), "rank": row.get(side + "_rank")}
    html, rec = get("/player/%s" % pid)
    if html is None:
        summary["errors"].append("player page failed")
        return
    save("player.html", html)
    text = html.decode("utf-8", "replace")
    summary["playerPage"] = {
        "status": rec.get("status"),
        "hasGameList": "game-list" in text,
        "hasRatingGroup": "rating-group" in text,
        "battleAtCells": text.count("battle-at"),
        "printDateTime": text.count("printDateTime("),
        "hxGets": re.findall(r'hx-get="([^"]+)"', text)[:20],
        "forms": re.findall(r'<form[^>]*>', text)[:10],
        "selects": re.findall(r'<select[^>]*name="([^"]+)"', text)[:10],
    }
    nxt = None
    for href in summary["playerPage"]["hxGets"]:
        h = href.replace("&amp;", "&")
        if h.startswith("/player/"):
            nxt = h
            break
    if nxt:
        page2, rec2 = get(nxt)
        if page2 is not None:
            save("player-more.html", page2)
            summary["playerMore"] = {"path": nxt, "status": rec2.get("status"), "bytes": len(page2)}


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        summary["errors"].append("crash: %r" % err)
    summary["finishedAt"] = int(time.time())
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)
    print(json.dumps(summary, indent=2)[:4000])
    sys.exit(0)

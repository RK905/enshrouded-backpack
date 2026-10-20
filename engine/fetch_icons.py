"""Download catalog item icons from the official Enshrouded wiki."""
import json
import os
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "itemdb2.json")
OUT_DIR = os.path.join(ROOT, "data", "icons")
API = "https://enshrouded.wiki.gg/api.php"
UA = "enshrouded-backpack/1.0 (personal desktop tool)"


def request_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def chunks(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    db = json.load(open(DB_PATH, encoding="utf-8"))
    items = []
    for hex_id, row in db["items"].items():
        if int(row[3]) < 1:
            continue
        items.append((hex_id, row[0]))
    names = sorted({name for _, name in items})
    name_to_url = {}
    for batch_index, batch in enumerate(chunks(names, 40), start=1):
        titles = "|".join("File:" + name + ".png" for name in batch)
        url = API + "?" + urllib.parse.urlencode({
            "action": "query",
            "format": "json",
            "prop": "imageinfo",
            "iiprop": "url|mime",
            "iiurlwidth": "180",
            "titles": titles,
        })
        data = request_json(url)
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [None])[0]
            title = page.get("title") or ""
            if not info or not title.startswith("File:") or not title.lower().endswith(".png"):
                continue
            mime = info.get("mime") or ""
            if not mime.startswith("image/"):
                continue
            picture = info.get("thumburl") or info.get("url")
            if picture:
                name_to_url[title[5:-4]] = picture
        print("lookup", batch_index, "matched", len(name_to_url), flush=True)
        time.sleep(0.15)

    by_url = {}
    for hex_id, name in items:
        picture = name_to_url.get(name)
        if picture:
            by_url.setdefault(picture, []).append(hex_id)

    def download(job):
        picture, ids = job
        req = urllib.request.Request(picture, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            blob = resp.read()
        if blob[:8] != b"\x89PNG\r\n\x1a\n":
            return 0
        for hex_id in ids:
            dest = os.path.join(OUT_DIR, hex_id + ".png")
            with open(dest, "wb") as handle:
                handle.write(blob)
        return 1

    saved = 0
    failed = 0
    jobs = list(by_url.items())
    with ThreadPoolExecutor(max_workers=12) as pool:
        for result in pool.map(download, jobs):
            if result:
                saved += result
            else:
                failed += 1
            if (saved + failed) % 200 == 0:
                print("saved", saved, "failed", failed, flush=True)
    have = len({hex_id for ids in by_url.values() for hex_id in ids})
    print("done pictures", have, "of", len(items), "unique files", len(jobs), "failed", failed)


if __name__ == "__main__":
    main()

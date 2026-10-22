import hashlib
import time
from pathlib import Path

import requests

BASE = "https://campus.tum.de/tumonline"
RAW = Path(__file__).resolve().parent.parent / "raw"
DELAY = 0.25

_session = requests.Session()
_session.headers["User-Agent"] = "stundenplan-personal-scraper/0.1 (bioinformatik@fs.lmu.de)"
_last = 0.0


def fetch(url, kind, key, json=False, refresh=False, params=None):
    """GET with on-disk cache, politeness delay and retries. Returns text."""
    global _last
    ext = "json" if json else "html"
    path = RAW / kind / f"{hashlib.md5(key.encode()).hexdigest()[:10]}_{key[:60].replace('/', '_').replace(' ', '_')}.{ext}"
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")
    headers = {"Accept": "application/json"} if json else {}
    err = None
    for attempt in range(3):
        wait = DELAY - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            r = _session.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(r.text, encoding="utf-8")
            return r.text
        except requests.RequestException as e:
            err = e
            time.sleep(2 ** attempt)
    raise err


def download(url, path, refresh=False):
    """GET a binary file (PDF) to `path` with the politeness delay and retries; an existing file is kept unless refresh."""
    global _last
    path = Path(path)
    if path.exists() and not refresh:
        return path
    err = None
    for attempt in range(3):
        wait = DELAY - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            r = _session.get(url, timeout=60)
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                raise requests.RequestException(f"{url} is not a PDF")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            return path
        except requests.RequestException as e:
            err = e
            time.sleep(2 ** attempt)
    raise err


def get_live(url, headers=None):
    """Uncached GET on the shared session (cookies kept), with delay and retries. Returns response text."""
    global _last
    err = None
    for attempt in range(3):
        wait = DELAY - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            r = _session.get(url, headers=headers or {}, timeout=30)
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            err = e
            time.sleep(2 ** attempt)
    raise err


def ensure_session(force=False):
    """Node callbacks need a PSESSIONID cookie, not a particular page; open one handbook page for it."""
    if force or not _session.cookies:
        _session.cookies.clear()
        get_live(f"{BASE}/WBMODHB.wbShow?pOrgNr=1")

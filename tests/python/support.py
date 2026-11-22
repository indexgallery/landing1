"""HTTP + PostgreSQL helpers for the disposable Compose stack only."""
import base64
import json
import os
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

import psycopg

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
)


def configuration():
    base = os.environ.get("BASE_URL", "").rstrip("/")
    database = os.environ.get("DATABASE_URL", "")
    # Tests publish and delete objects: refuse arbitrary/local production targets.
    if (os.environ.get("CATALOG_INTEGRATION") != "1"
            or base != "http://web:4173"
            or urlparse(database).hostname != "postgres"
            or urlparse(database).path != "/integration"):
        raise RuntimeError("Use scripts/test_integration.py with its disposable Compose stack.")
    return base, database


class Client:
    def __init__(self):
        self.base, _ = configuration()
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def request(self, path, method="GET", data=None, raw=None, headers=None, origin=None):
        url = path if path.startswith("http://") else self.base + path
        request_headers = dict(headers or {})
        if method not in ("GET", "HEAD", "OPTIONS"):
            request_headers.setdefault("Origin", origin or self.base)
        if data is not None:
            raw = json.dumps(data, ensure_ascii=False).encode()
            request_headers.setdefault("Content-Type", "application/json")
        request = Request(url, data=raw, method=method, headers=request_headers)
        try:
            response = self.opener.open(request, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            return response.code, response.headers, payload

    def json(self, path, method="GET", data=None, **kwargs):
        code, headers, payload = self.request(path, method, data=data, **kwargs)
        return code, headers, json.loads(payload)

    def login(self):
        code, headers, _ = self.json("/api/session", "POST", {"password": os.environ["ADMIN_PASSWORD"]})
        if code != 200:
            raise AssertionError(f"Login failed: HTTP {code}")
        return headers


def database_connection():
    _, database = configuration()
    return psycopg.connect(database, autocommit=True)


def current_state(client):
    code, _, state = client.json("/api/catalogue")
    if code != 200:
        raise AssertionError(f"Catalogue failed: HTTP {code}")
    return state

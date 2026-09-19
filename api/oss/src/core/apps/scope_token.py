"""Folder-scoped tokens for agent HTML apps: the server half of the folder rule.

Until this existed, "the app may only touch its own folder" was enforced in one place — the
browser tab that assembles the page. The server saw a request from a signed-in person for a file
in a drive they can read, which is exactly what it is, and said yes. One bug in the page's path
handling and the app reached the whole mount; there was a real one (markup references skipped the
check entirely) and it was found by looking, not by anything failing.

The token is how the folder becomes something the server knows about. The page asks for one when
the person grants an app access, naming the mount, the folder and the level. Every bridge call
then carries it, and the mounts router refuses a path outside the prefix or a write under a read
token.

It NARROWS and never widens. The caller still authenticates as themselves and still passes the
project permission check; the token can only take access away. So a stolen token grants nothing
its holder did not already have, and a missing token means the request is simply an ordinary
one — the browser attaching it is how the drive's own UI stays unaffected.

Stateless on purpose: an HMAC over the claims with the deployment's `AGENTA_CRYPT_KEY`, so there
is no table to migrate, nothing to clean up, and no lookup on the hot path. Short lived, because
a folder grant is a browser-session thing and a token that outlives the tab is a token someone
has to think about.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from oss.src.utils.env import env

# A grant lives as long as the tab; the token is refreshed from the page well inside this.
TOKEN_TTL_SECONDS = 60 * 30

_ALG = "ag-app-v1"


class ScopeTokenInvalid(Exception):
    """The token is malformed, unsigned, expired, or does not match the request."""


@dataclass(frozen=True)
class AppScope:
    """What one token permits: one folder of one mount, at one level."""

    project_id: str
    mount_id: str
    # Mount-relative app dir, no leading or trailing slash. "" would be the whole mount and is
    # refused at mint time — a token that scopes to everything is not a scope.
    prefix: str
    # "read" or "read-write".
    level: str
    expires_at: int

    def allows_path(self, path: str) -> bool:
        """True when `path` is the folder itself or sits inside it."""
        clean = (path or "").strip("/")
        if not self.prefix:
            return False
        return clean == self.prefix or clean.startswith(f"{self.prefix}/")

    def allows_write(self) -> bool:
        return self.level == "read-write"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(payload: bytes) -> str:
    key = hashlib.sha256((env.agenta.crypt_key or "").encode()).digest()
    return _b64(hmac.new(key, payload, hashlib.sha256).digest())


def mint(
    *,
    project_id: UUID,
    mount_id: UUID,
    prefix: str,
    level: str,
    ttl_seconds: int = TOKEN_TTL_SECONDS,
) -> tuple[str, int]:
    """Sign a scope token. Returns `(token, expires_at)`.

    `prefix` must name a folder: an empty prefix would scope to the whole mount, which is the
    thing this exists to prevent, so it is refused rather than silently widened.
    """
    # Whitespace first: `"   ".strip("/")` is still truthy, and a signed blank prefix would be a
    # token nothing matches — or worse, one a later reader treats as "the whole mount".
    clean = (prefix or "").strip().strip("/").strip()
    if not clean:
        raise ScopeTokenInvalid(
            "a scope token needs a folder; the mount root is not a scope"
        )
    if level not in ("read", "read-write"):
        raise ScopeTokenInvalid(f"unknown level {level!r}")

    expires_at = int(time.time()) + ttl_seconds
    claims = {
        "a": _ALG,
        "p": str(project_id),
        "m": str(mount_id),
        "d": clean,
        "l": level,
        "x": expires_at,
    }
    payload = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    return f"{_b64(payload)}.{_sign(payload)}", expires_at


def parse(token: str) -> AppScope:
    """Verify a token and return its scope. Raises {@link ScopeTokenInvalid} on anything wrong."""
    if not token or token.count(".") != 1:
        raise ScopeTokenInvalid("malformed token")
    body, signature = token.split(".", 1)
    try:
        payload = _unb64(body)
    except Exception as exc:  # noqa: BLE001 - any decode failure is the same answer
        raise ScopeTokenInvalid("malformed token") from exc

    # Constant-time: a timing oracle on the signature is how forgery starts.
    if not hmac.compare_digest(_sign(payload), signature):
        raise ScopeTokenInvalid("bad signature")

    try:
        claims = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ScopeTokenInvalid("malformed token") from exc

    if claims.get("a") != _ALG:
        raise ScopeTokenInvalid("unknown token version")
    if int(claims.get("x", 0)) <= int(time.time()):
        raise ScopeTokenInvalid("token expired")

    return AppScope(
        project_id=str(claims.get("p") or ""),
        mount_id=str(claims.get("m") or ""),
        prefix=str(claims.get("d") or ""),
        level=str(claims.get("l") or ""),
        expires_at=int(claims["x"]),
    )


def enforce(
    *,
    token: Optional[str],
    project_id: UUID,
    mount_id: UUID,
    path: Optional[str],
    writing: bool,
) -> None:
    """Apply a scope token to one file request, if the caller sent one.

    No token means no narrowing: the request stands or falls on the project permission check, the
    way every other drive call does. With a token, all four have to hold — same project, same
    mount, path inside the folder, and the level covers the method.
    """
    if token is None:
        return

    scope = parse(token)

    if scope.project_id != str(project_id) or scope.mount_id != str(mount_id):
        raise ScopeTokenInvalid("token was issued for a different drive")
    if writing and not scope.allows_write():
        raise ScopeTokenInvalid("this app was granted read access only")
    if path is not None and not scope.allows_path(path):
        raise ScopeTokenInvalid("path is outside the app folder")

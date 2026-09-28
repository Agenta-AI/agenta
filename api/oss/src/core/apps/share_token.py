"""Share tokens for agent HTML apps: the link a viewer opens.

Stateless, like the scope token: an HMAC over the claims with a key derived for this purpose
alone, so a scope token never verifies as a share token and neither shares key bytes with secret
encryption. The token has no expiry. The nonce stored with the share is what revokes it: "share
again" writes a new nonce, and every earlier link stops matching.

The payload is readable. It carries ids, not secrets.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from uuid import UUID

from oss.src.utils.crypting import derive_key, is_default_crypt_key

_ALG = "ag-share-v1"
_KEY_LABEL = "agenta/app-share/v1"


class ShareTokenInvalid(Exception):
    """The token is malformed, unsigned, or not a share token."""


class SharingDisabled(Exception):
    """The deployment runs on the placeholder crypt key, so no share link is issued or accepted."""


@dataclass(frozen=True)
class ShareClaims:
    project_id: UUID
    mount_id: UUID
    app_path: str
    nonce: str


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: bytes) -> str:
    return _b64(hmac.new(derive_key(_KEY_LABEL), payload, hashlib.sha256).digest())


def mint(*, project_id: UUID, mount_id: UUID, app_path: str, nonce: str) -> str:
    if is_default_crypt_key():
        raise SharingDisabled()
    claims = {
        "a": _ALG,
        "p": str(project_id),
        "m": str(mount_id),
        "d": app_path,
        "n": nonce,
    }
    payload = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    return f"{_b64(payload)}.{_sign(payload)}"


def parse(token: str) -> ShareClaims:
    if is_default_crypt_key():
        raise SharingDisabled()
    if not token or token.count(".") != 1:
        raise ShareTokenInvalid()
    body, signature = token.split(".", 1)
    try:
        payload = _unb64(body)
    except Exception as exc:  # noqa: BLE001 - any decode failure is the same answer
        raise ShareTokenInvalid() from exc
    if not hmac.compare_digest(_sign(payload), signature):
        raise ShareTokenInvalid()
    try:
        claims = json.loads(payload)
        if claims.get("a") != _ALG:
            raise ShareTokenInvalid()
        return ShareClaims(
            project_id=UUID(claims["p"]),
            mount_id=UUID(claims["m"]),
            app_path=str(claims["d"]),
            nonce=str(claims["n"]),
        )
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise ShareTokenInvalid() from exc

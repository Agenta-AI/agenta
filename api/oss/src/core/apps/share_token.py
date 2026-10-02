"""Share tokens for agent HTML apps: the link a viewer opens.

Stateless, like the scope token: an HMAC over the claims with a key derived for this purpose
alone, so a scope token never verifies as a share token and neither shares key bytes with secret
encryption. The token has no expiry. The nonce stored with the share is what revokes it: "share
again" writes a new nonce, and every earlier link stops matching.

The payload is readable. It carries ids, not secrets.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from oss.src.utils.crypting import is_default_crypt_key, sign_claims, verify_claims

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


def mint(*, project_id: UUID, mount_id: UUID, app_path: str, nonce: str) -> str:
    if is_default_crypt_key():
        raise SharingDisabled()
    return sign_claims(
        _KEY_LABEL,
        {
            "a": _ALG,
            "p": str(project_id),
            "m": str(mount_id),
            "d": app_path,
            "n": nonce,
        },
    )


def parse(token: str) -> ShareClaims:
    if is_default_crypt_key():
        raise SharingDisabled()
    try:
        claims = verify_claims(_KEY_LABEL, token)
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

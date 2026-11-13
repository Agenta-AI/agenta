"""License key format and check: `agenta_license_v1.<payload>.<signature>`.

`<payload>` is base64url (no padding) of UTF-8 JSON; `<signature>` is base64url (no
padding) of the Ed25519 signature of the ASCII bytes of `<payload>`. The check runs
offline, against `PUBLIC_KEY`.
"""

import base64
import json
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from pydantic import ValidationError

from oss.src.utils.logging import get_module_logger

from ee.src.core.access.controls import get_plans
from ee.src.core.licenses.types import (
    LICENSE_KEY_PREFIX,
    InvalidLicenseKey,
    LicenseKey,
)

log = get_module_logger(__name__)


# Agenta's license signing public key (PEM). PLACEHOLDER: empty until the release puts
# the real public key here, and until then no license key checks.
PUBLIC_KEY: str = ""

# `key_id`s (lowercase UUID text) that a release refuses, for example a leaked key.
REVOKED_KEY_IDS: frozenset[str] = frozenset()

_MAX_KEY_LENGTH = 8192
_BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")


def _b64url_decode(part: str) -> bytes:
    if not _BASE64URL.match(part):
        raise InvalidLicenseKey("format")
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except ValueError as e:
        raise InvalidLicenseKey("format") from e


def _public_key() -> Ed25519PublicKey:
    if not PUBLIC_KEY:
        log.warning("[licenses] this build has no license public key")
        raise InvalidLicenseKey("no_public_key")
    key = load_pem_public_key(PUBLIC_KEY.encode("ascii"))
    if not isinstance(key, Ed25519PublicKey):
        raise InvalidLicenseKey("no_public_key")
    return key


def parse_license_key(text: str) -> LicenseKey:
    """The payload of a key whose signature checks, whose `key_id` is not refused, and
    whose plan is in the plan table. Expiry is not checked here."""
    text = (text or "").strip()
    if len(text) > _MAX_KEY_LENGTH:
        raise InvalidLicenseKey("format")

    parts = text.split(".")
    if len(parts) != 3 or parts[0] != LICENSE_KEY_PREFIX:
        raise InvalidLicenseKey("format")
    _, payload_part, signature_part = parts

    payload_bytes = _b64url_decode(payload_part)
    signature = _b64url_decode(signature_part)
    try:
        _public_key().verify(signature, payload_part.encode("ascii"))
    except InvalidSignature as e:
        raise InvalidLicenseKey("signature") from e

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
        if not isinstance(payload, dict):
            raise InvalidLicenseKey("payload")
        license_key = LicenseKey.model_validate(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as e:
        raise InvalidLicenseKey("payload") from e

    if str(license_key.key_id) in REVOKED_KEY_IDS:
        raise InvalidLicenseKey("refused")

    if license_key.plan not in get_plans():
        raise InvalidLicenseKey("plan")

    return license_key

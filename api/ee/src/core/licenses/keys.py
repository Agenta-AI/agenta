"""License key format and check: `agenta_license_v1.<payload>.<signature>`.

`<payload>` is base64url (no padding) of UTF-8 JSON; `<signature>` is base64url (no
padding) of the Ed25519 signature of the ASCII bytes of `<payload>`. The payload names
the key pair that signed it in `signing_key_id`. The check runs offline, against the
public key that `SIGNING_KEYS` holds for that id, and refuses a plan that key may not
sign.
"""

import base64
import json
import re
from dataclasses import dataclass
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key
from pydantic import ValidationError

from oss.src.utils.logging import get_module_logger

from ee.src.core.access.entitlements.types import DefaultPlan
from ee.src.core.licenses.types import (
    CLOUD_PLAN,
    LICENSE_KEY_PREFIX,
    InvalidLicenseKey,
    LicenseKey,
)

log = get_module_logger(__name__)


@dataclass(frozen=True)
class SigningKey:
    """One of Agenta's license signing key pairs, as the API knows it.

    `public_key` is the base64 line of the public key PEM (the line between the BEGIN
    and END lines). Empty is a placeholder: no license key signed by it checks.
    `plans` is the set of plans the key may sign; `None` means any plan.
    """

    public_key: str
    plans: Optional[frozenset[str]] = None


# Agenta's license signing public keys, by the `signing_key_id` a key carries. The
# release key stays offline and signs any plan, cloud keys included. The registration
# key lives in the website worker and signs only free registration keys. To rotate,
# add a key under a new id and keep the old one, so keys already issued stay valid.
# PLACEHOLDERS: empty until the release puts the real public keys here.
SIGNING_KEYS: dict[str, SigningKey] = {
    "release-1": SigningKey(public_key=""),
    "registration-1": SigningKey(
        public_key="",
        plans=frozenset({DefaultPlan.SELF_HOSTED_REGISTERED.value}),
    ),
}

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


def _public_key(signing_key: SigningKey) -> Ed25519PublicKey:
    if not signing_key.public_key:
        log.warning("[licenses] this build has no public key for this signing key")
        raise InvalidLicenseKey("no_public_key")
    key = load_der_public_key(base64.b64decode(signing_key.public_key))
    if not isinstance(key, Ed25519PublicKey):
        raise InvalidLicenseKey("no_public_key")
    return key


def parse_license_key(text: str) -> LicenseKey:
    """The payload of a key whose signature checks against the key pair it names, whose
    plan that key pair may sign, whose `key_id` is not refused, and whose plan is
    `cloud` or in the plan table. Expiry is not checked here."""
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
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise InvalidLicenseKey("payload") from e
    if not isinstance(payload, dict):
        raise InvalidLicenseKey("payload")

    # The id only picks the public key; the signature then covers it with the rest.
    signing_key_id = payload.get("signing_key_id")
    signing_key = (
        SIGNING_KEYS.get(signing_key_id) if isinstance(signing_key_id, str) else None
    )
    if signing_key is None:
        raise InvalidLicenseKey("signing_key")
    try:
        _public_key(signing_key).verify(signature, payload_part.encode("ascii"))
    except InvalidSignature as e:
        raise InvalidLicenseKey("signature") from e

    try:
        license_key = LicenseKey.model_validate(payload)
    except ValidationError as e:
        raise InvalidLicenseKey("payload") from e

    if signing_key.plans is not None and license_key.plan not in signing_key.plans:
        raise InvalidLicenseKey("signing_key_plan")

    if str(license_key.key_id) in REVOKED_KEY_IDS:
        raise InvalidLicenseKey("refused")

    if license_key.plan == CLOUD_PLAN:
        return license_key

    # Imported here: building the plan table calls `is_cloud()`, which parses a key.
    from ee.src.core.access.controls import get_plans  # noqa: PLC0415

    if license_key.plan not in get_plans():
        raise InvalidLicenseKey("plan")

    return license_key

"""The opaque references the channel tools hand to the model.

A destination is a space row: `dst_<space id>`. A thread or a message is a
provider reference (Slack `ts`, Telegram `message_id`) inside one space,
packed with that space's id so a reference used against another destination
is refused without a lookup. None of them is a permission: every call looks
the space up again inside the caller's project and bots.

Decoding never raises. Anything malformed, including a raw Slack or Telegram
id, decodes to None, which the caller reports as not found.
"""

import base64
import binascii
from typing import Any, Optional, Tuple
from uuid import UUID

_DESTINATION_PREFIX = "dst_"
_MAX_LENGTH = 256


def encode_destination_id(space_id: UUID) -> str:
    return f"{_DESTINATION_PREFIX}{space_id.hex}"


def decode_destination_id(value: Any) -> Optional[UUID]:
    if not isinstance(value, str) or not value.startswith(_DESTINATION_PREFIX):
        return None
    return _uuid(value[len(_DESTINATION_PREFIX) :])


def encode_space_ref(kind: str, space_id: UUID, ref: str) -> str:
    raw = f"{space_id.hex}:{ref}".encode()
    return f"{kind}_{base64.urlsafe_b64encode(raw).decode().rstrip('=')}"


def decode_space_ref(kind: str, value: Any) -> Optional[Tuple[UUID, str]]:
    prefix = f"{kind}_"
    if (
        not isinstance(value, str)
        or not value.startswith(prefix)
        or len(value) > _MAX_LENGTH
    ):
        return None
    body = value[len(prefix) :]
    try:
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None
    space_hex, sep, ref = raw.partition(":")
    space_id = _uuid(space_hex)
    if not sep or not ref or space_id is None:
        return None
    return space_id, ref


def _uuid(value: str) -> Optional[UUID]:
    if len(value) != 32:
        return None
    try:
        return UUID(hex=value)
    except ValueError:
        return None

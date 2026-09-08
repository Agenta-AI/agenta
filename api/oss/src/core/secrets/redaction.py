"""Redaction of write-only vault secrets for user-facing responses.

A secret with ``write_only=True`` can be created, replaced, and deleted, but its value is
never returned to an ordinary user. Every outward route returns a public projection with
``value_status``; trusted runtime callers receive credential values in that same public
shape. In-process readers (`VaultService` and below) are untouched: redaction happens
strictly at the response boundary.

WHAT counts as credential material inside a connection is not decided here: that
vocabulary lives in the SDK (``agenta.sdk.agents.connections.credentials``) and is
imported, so the extras the SDK resolver consumes as credentials and the extras this
module strips can never drift. The per-kind primary field below is this side's own,
because it covers kinds the SDK never resolves.
"""

from typing import Any, Dict, Optional, Tuple

from agenta.sdk.agents.connections.credentials import CREDENTIAL_EXTRAS_KEYS

from oss.src.core.secrets.dtos import (
    PublicSecretResponseDTO,
    SecretResponseDTO,
    SecretValueStatus,
)


# The primary value field per secret kind, as (container attribute, field name). Lives
# here rather than in the SDK classifier because it spans kinds the SDK never resolves —
# SSO providers, webhook signing secrets — and no SDK code reads it. The extras
# vocabulary beside it IS shared, and stays imported.
PRIMARY_CREDENTIAL_FIELDS: Dict[str, Tuple[str, str]] = {
    "provider_key": ("provider", "key"),
    "custom_provider": ("provider", "key"),
    "webhook_provider": ("provider", "key"),
    "sso_provider": ("provider", "client_secret"),
    "custom_secret": ("secret", "content"),
}


# Credential fields that sit on the data object itself instead of inside a nested
# container. A subscription connection keeps both its harness login and its in-flight
# device attempt here, and neither may reach a browser: the login is the credential, and
# the attempt is the one-time handle that redeems it. Unlike the primary fields above,
# these are stripped whatever `write_only` says, because a subscription has no readable
# form of its credential at all.
DATA_CREDENTIAL_FIELDS: Dict[str, Tuple[str, ...]] = {
    "subscription_provider": ("login", "login_attempt"),
}


# Every secret kind states where its credential lives, in exactly ONE of the two maps
# above: a kind in neither is a kind nothing redacts. The maps stay separate because their
# shapes differ (a nested container and a field, against fields on the data object), and a
# kind in both would give one credential two locations that can disagree. Assert against
# this set rather than against either map alone.
CREDENTIAL_FIELD_KINDS: frozenset = frozenset(PRIMARY_CREDENTIAL_FIELDS) | frozenset(
    DATA_CREDENTIAL_FIELDS
)


def mask_secret_value(value: str) -> str:
    """A short, non-reversible display preview like ``sk-****9Qa``.

    Policy: values under 20 characters mask entirely; longer ones disclose at most 3+3
    characters and never more than 25% of the value (so a 20-character value shows 5).
    """
    if len(value) < 20:
        return "****"

    disclosed = min(6, len(value) // 4)
    prefix = disclosed - disclosed // 2
    suffix = disclosed // 2

    return f"{value[:prefix]}****{value[-suffix:]}"


def primary_credential_value(secret: SecretResponseDTO) -> Optional[Any]:
    """The kind's primary value field (key, client_secret, content, login), or None."""
    data_fields = DATA_CREDENTIAL_FIELDS.get(str(secret.kind.value))
    if data_fields:
        return getattr(secret.data, data_fields[0], None)

    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(secret.kind.value), (None, None)
    )
    if container_name is None:
        return None

    container = getattr(secret.data, container_name, None)
    return getattr(container, field, None) if container is not None else None


def _value_status(secret: SecretResponseDTO) -> SecretValueStatus:
    """Describe whether credential material exists without exposing it."""
    value = primary_credential_value(secret)
    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(secret.kind.value), (None, None)
    )
    container = getattr(secret.data, container_name, None) if container_name else None
    extras = getattr(container, "extras", None) or {}
    has_credential_extras = any(
        extras.get(extras_key) not in (None, "")
        for extras_key in CREDENTIAL_EXTRAS_KEYS
    )

    return SecretValueStatus(
        configured=value not in (None, "") or has_credential_extras,
        preview=(
            mask_secret_value(value)
            if secret.write_only and isinstance(value, str) and value
            else None
        ),
    )


def project_secret_response(
    secret: SecretResponseDTO,
    *,
    reveal_write_only: bool,
) -> PublicSecretResponseDTO:
    """Build the public response, optionally retaining a write-only value for runtime."""
    public_data = secret.model_dump(mode="python", exclude={"management"})
    if secret.management is not None:
        public_data["management"] = {"policy": secret.management.policy}

    projected = PublicSecretResponseDTO.model_validate(
        {**public_data, "value_status": _value_status(secret)}
    )

    if not reveal_write_only:
        for field in DATA_CREDENTIAL_FIELDS.get(str(projected.kind.value), ()):
            if hasattr(projected.data, field):
                setattr(projected.data, field, None)

    if not secret.write_only or reveal_write_only:
        return projected

    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(projected.kind.value), (None, None)
    )
    if container_name is None:
        return projected

    container = getattr(projected.data, container_name, None)
    if container is None:
        return projected

    if hasattr(container, field):
        setattr(container, field, None)

    extras = getattr(container, "extras", None)
    if extras:
        for extras_key in CREDENTIAL_EXTRAS_KEYS:
            extras.pop(extras_key, None)

    return projected


def redact_secret_response(secret: SecretResponseDTO) -> PublicSecretResponseDTO:
    """Return the public response with write-only credential material stripped."""
    return project_secret_response(secret, reveal_write_only=False)

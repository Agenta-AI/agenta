"""Redaction of write-only vault secrets for user-facing responses.

A secret with ``write_only=True`` can be created, replaced, and deleted, but its value is
never returned to a user: every outward route strips the credential material and attaches
``has_key`` and a ``key_preview`` instead. Only the platform runtime — a caller whose
verified Secret token carries the ``secret-resolve`` grant — receives the plaintext,
because the workload it runs needs the real key. In-process readers (`VaultService` and
below) are untouched: redaction happens strictly at the response boundary.

WHAT counts as credential material is not decided here: the canonical classifier lives in
the SDK (``agenta.sdk.agents.connections.credentials``) and is imported, so the fields the
SDK resolver consumes as credentials and the fields this module strips can never drift.
"""

from typing import Any, Optional

from agenta.sdk.agents.connections.credentials import (
    CREDENTIAL_EXTRAS_KEYS,
    PRIMARY_CREDENTIAL_FIELDS,
)

from oss.src.core.secrets.dtos import SecretResponseDTO


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
    """The kind's primary value field (key, client_secret, content), or None."""
    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(secret.kind.value), (None, None)
    )
    if container_name is None:
        return None

    container = getattr(secret.data, container_name, None)
    return getattr(container, field, None) if container is not None else None


def redact_secret_response(secret: SecretResponseDTO) -> SecretResponseDTO:
    """The user-facing shape of ``secret``: credential material stripped when write-only.

    Returns the input unchanged for readable (``write_only=False``) secrets, so legacy
    records keep their exact response. Never mutates the input.
    """
    if not secret.write_only:
        return secret

    redacted = secret.model_copy(deep=True)

    container_name, field = PRIMARY_CREDENTIAL_FIELDS.get(
        str(redacted.kind.value), (None, None)
    )
    value: Optional[Any] = None
    has_credential_extras = False

    if container_name is not None:
        container = getattr(redacted.data, container_name, None)
        if container is not None and hasattr(container, field):
            value = getattr(container, field)
            setattr(container, field, None)

        extras = getattr(container, "extras", None) if container is not None else None
        if extras:
            for extras_key in CREDENTIAL_EXTRAS_KEYS:
                if extras.pop(extras_key, None) not in (None, ""):
                    has_credential_extras = True

    redacted.has_key = bool(value) or has_credential_extras
    redacted.key_preview = (
        mask_secret_value(value) if isinstance(value, str) and value else None
    )

    return redacted

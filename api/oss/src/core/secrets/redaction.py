"""Redaction of write-only vault secrets for user-facing responses.

A secret with ``write_only=True`` can be created, replaced, and deleted, but its value is
never returned to a user: every vault route strips the value and attaches ``has_key`` and a
``key_preview`` instead. Only the platform runtime — a caller whose verified Secret token
carries the ``secret-resolve`` grant — receives the plaintext, because the workload it runs
needs the real key. In-process readers (`VaultService` and below) are untouched: redaction
happens strictly at the API response boundary.
"""

from typing import Any, Optional

from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.dtos import SecretResponseDTO


# Keys inside a custom provider's free-form `extras` that hold credential material (the
# SDK's connection resolver consumes `extras.api_key` as the key, and the AWS trio is
# injected as credentials). Redaction strips these; plain config (region, api_version)
# stays readable. `VaultService`'s update carry-over fills the same set back in when a
# replace-only form omits them.
CREDENTIAL_EXTRAS_KEYS = (
    "api_key",
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
)


def mask_secret_value(value: str) -> str:
    """A short, non-reversible display preview like ``sk-****9Qa``.

    Values shorter than 12 characters mask entirely: revealing 6 of their characters
    would give away most of the secret.
    """
    if len(value) >= 12:
        return f"{value[:3]}****{value[-3:]}"

    return "****"


def redact_secret_response(secret: SecretResponseDTO) -> SecretResponseDTO:
    """The user-facing shape of ``secret``: value stripped when it is write-only.

    Returns the input unchanged for readable (``write_only=False``) secrets, so legacy
    records keep their exact response. Never mutates the input.
    """
    if not secret.write_only:
        return secret

    redacted = secret.model_copy(deep=True)

    value: Optional[Any] = None
    data = redacted.data

    if redacted.kind in (
        SecretKind.PROVIDER_KEY,
        SecretKind.CUSTOM_PROVIDER,
        SecretKind.WEBHOOK_PROVIDER,
    ):
        value = data.provider.key
        data.provider.key = None
        extras = getattr(data.provider, "extras", None)
        if extras:
            value = value or extras.get("api_key")
            for extras_key in CREDENTIAL_EXTRAS_KEYS:
                extras.pop(extras_key, None)
    elif redacted.kind == SecretKind.SSO_PROVIDER:
        value = data.provider.client_secret
        data.provider.client_secret = None
    elif redacted.kind == SecretKind.CUSTOM_SECRET:
        value = data.secret.content
        data.secret.content = None

    redacted.has_key = bool(value)
    redacted.key_preview = (
        mask_secret_value(value) if isinstance(value, str) and value else None
    )

    return redacted

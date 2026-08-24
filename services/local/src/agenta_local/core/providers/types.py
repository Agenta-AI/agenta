"""Typed provider-domain failures and credential-store rules (contracts.md)."""

import re

from ..exceptions import DomainError

# Provider names route credentials and appear in URL paths: lowercase slug only.
PROVIDER_NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")

# Redacted suffix length shown to the browser; shorter keys are fully masked.
KEY_SUFFIX_LENGTH = 4
MIN_KEY_LENGTH_FOR_SUFFIX = 8


class ProviderNotConfigured(DomainError):
    code = "provider_not_configured"


class ProviderNameInvalid(DomainError):
    code = "provider_invalid_name"


class CredentialsFileInsecure(DomainError):
    """Refused instead of repaired: symlinked target, foreign owner, or loose
    permission bits on the credential file."""

    code = "credentials_file_insecure"


class CredentialsFileCorrupt(DomainError):
    code = "credentials_file_corrupt"


def validate_provider_name(provider: str) -> str:
    if not PROVIDER_NAME_PATTERN.fullmatch(provider):
        raise ProviderNameInvalid(f"provider name {provider!r} must match [a-z0-9_-]+")
    return provider


def redact_key_suffix(api_key: str) -> str:
    if len(api_key) < MIN_KEY_LENGTH_FOR_SUFFIX:
        return "***"
    return f"...{api_key[-KEY_SUFFIX_LENGTH:]}"

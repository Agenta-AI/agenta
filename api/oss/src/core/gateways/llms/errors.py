"""The sentence a person reads when the model endpoint behind the gateway fails.

Two codes, carried in the message's code marker so the runner can tell the gateway's sentence
from a provider's raw text: `upstream_error` means another attempt may work, and is the
fallback; `upstream_rejected` means something has to change first (the request, the key, the
account).
"""

import re
from typing import Any, Optional

from oss.src.core.gateways.dtos import with_code_marker

UPSTREAM_ERROR = "upstream_error"
UPSTREAM_REJECTED = "upstream_rejected"

# The statuses the OpenAI and Anthropic SDKs retry on their own.
_RETRYABLE_STATUSES = frozenset({408, 409, 429})

# Provider codes and types that no retry gets past, for an error that came with no status.
_REJECTED_CODES = frozenset(
    {
        "insufficient_quota",
        "context_length_exceeded",
        "invalid_api_key",
        "invalid_request_error",
        "authentication_error",
        "permission_error",
    }
)

# Seen from a custom endpoint with no status or code to go on.
_NO_CREDITS = re.compile(r"no credits remaining", re.IGNORECASE)

_ADVICE = {
    UPSTREAM_ERROR: "Try again.",
    UPSTREAM_REJECTED: "Check the endpoint's key, account and model, or change the request.",
}

# Shown when the stream breaks after it started. Pi retries a turn whose error text says
# "connection error", as it did when the cut stream reached it bare.
_CONNECTION_LOST = "stopped before the answer finished (connection error)"

_MESSAGE_MAX_CHARS = 300

_REDACTIONS = (
    (re.compile(r"\b(Bearer|Basic)\s+\S{6,}", re.IGNORECASE), r"\1 [secret]"),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}"), "[secret]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]+"), "[secret]"),
    (
        re.compile(
            r"\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password))\b\s*[=:]\s*\S+",
            re.IGNORECASE,
        ),
        r"\1=[secret]",
    ),
    # No marker in the provider's words may read as the gateway's own, nested ones included.
    (re.compile(r"[⟦⟧]"), ""),
    (re.compile(r"[\x00-\x1f\x7f]+"), " "),
)


def classify_upstream_error(*, status: Optional[int], code: Any, message: Any) -> str:
    # The provider's code first: OpenAI reports an account out of credit as HTTP 429.
    if (isinstance(code, str) and code in _REJECTED_CODES) or (
        isinstance(message, str) and _NO_CREDITS.search(message)
    ):
        return UPSTREAM_REJECTED
    if status is None or status >= 500 or status in _RETRYABLE_STATUSES:
        return UPSTREAM_ERROR
    return UPSTREAM_REJECTED


def upstream_error_message(
    *, label: Optional[str], code: str, provider_message: Any
) -> str:
    """One marked sentence that names the endpoint and quotes what it said, cleaned."""
    said = _cleaned(provider_message)
    quoted = f': "{said}"' if said else ""
    return with_code_marker(
        f"{_endpoint(label)} reported an error{quoted}. {_ADVICE[code]}", code
    )


def connection_lost_message(*, label: Optional[str]) -> str:
    return with_code_marker(
        f"{_endpoint(label)} {_CONNECTION_LOST}. {_ADVICE[UPSTREAM_ERROR]}",
        UPSTREAM_ERROR,
    )


def _endpoint(label: Optional[str]) -> str:
    return f'The model endpoint "{label}"' if label else "The model endpoint"


def _cleaned(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    text = " ".join(text.split()).rstrip(". ")
    if len(text) > _MESSAGE_MAX_CHARS:
        text = text[:_MESSAGE_MAX_CHARS].rstrip() + "..."
    return text

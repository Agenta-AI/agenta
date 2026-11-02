"""The sentence a person reads when the model behind the gateway fails.

Two codes, carried in the message's code marker so the runner can tell the gateway's sentence
from a provider's raw text: `upstream_error` means another attempt may work, and is the
fallback; `upstream_rejected` means something has to change first (the request, the key, the
account).
"""

import re
from typing import Any, Dict, Optional

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
_REDACTED_MAX_CHARS = 8192

# Every sentence starts so; the runner finds it by these words inside a harness's wrapper.
UPSTREAM_SENTENCE_START = "The model"

# A name starts only where no word or hyphen precedes it, so a long hyphenated text stays linear.
_NAMED_VALUE = re.compile(
    r"""(?<![\w-])(["']?)([\w-]*(?:key|token|secret|password|signature|sig|credential))\1"""
    r"""\s*([=:])\s*("[^"]*"|'[^']*'|\S+)""",
    re.IGNORECASE,
)
# Bare names that also appear in ordinary text ("Invalid key: model"): only `name=value`.
_AMBIGUOUS_NAMES = frozenset({"key", "token", "sig"})


def _redact_named_value(match: "re.Match[str]") -> str:
    name, separator = match.group(2), match.group(3)
    if separator == ":" and name.lower() in _AMBIGUOUS_NAMES:
        return match.group(0)
    return f"{name}=[secret]"


_REDACTIONS = (
    (re.compile(r"\b(Bearer|Basic)\s+\S{6,}", re.IGNORECASE), r"\1 [secret]"),
    # A provider's own masked copy of the key ("sk-proj-****...abcd", "sk-...3kKQ") still shows
    # its first and last characters. The part before the mask is bounded, so a long run of
    # "sk-a-" stays linear.
    (
        re.compile(
            r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{0,24}(?:\*{3,}|\.{3,})[A-Za-z0-9_-]*"
        ),
        "[secret]",
    ),
    (re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}"), "[secret]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]+"), "[secret]"),
    # Google API keys, AWS access key ids and Google OAuth access tokens.
    (re.compile(r"\bAIza[0-9A-Za-z_-]{20,}"), "[secret]"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[secret]"),
    (re.compile(r"\bya29\.[0-9A-Za-z._-]+"), "[secret]"),
    # A named value, in prose, JSON or a URL's query string (`?key=`, `X-Amz-Signature=`).
    (_NAMED_VALUE, lambda match: _redact_named_value(match)),
    # No marker in the provider's words may read as the gateway's own, nested ones included.
    (re.compile(r"[⟦⟧]"), ""),
    (re.compile(r"[\x00-\x1f\x7f]+"), " "),
    # Invisible and direction-changing characters, which can make the quote read differently.
    (re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]"), ""),
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
    *, code: str, provider_message: Any, built_in: bool = False
) -> str:
    """One marked sentence that quotes what the model said, cleaned.

    The built-in model quotes nothing, and a rejection there gets no advice: the person
    cannot change the platform's key or account."""
    said = "" if built_in else _cleaned(provider_message)
    quoted = f': "{said}"' if said else ""
    advice = "" if built_in and code == UPSTREAM_REJECTED else f" {_ADVICE[code]}"
    return with_code_marker(
        f"{UPSTREAM_SENTENCE_START} reported an error{quoted}.{advice}", code
    )


def connection_lost_message() -> str:
    return with_code_marker(
        f"{UPSTREAM_SENTENCE_START} {_CONNECTION_LOST}. {_ADVICE[UPSTREAM_ERROR]}",
        UPSTREAM_ERROR,
    )


def _cleaned(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    # Only the first 300 characters are shown, so the redaction never reads a whole 1 MiB body.
    text = text[:_REDACTED_MAX_CHARS]
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    text = " ".join(text.split()).rstrip(". ")
    if len(text) > _MESSAGE_MAX_CHARS:
        text = text[:_MESSAGE_MAX_CHARS].rstrip() + "..."
    return text


# Google's canonical status for an HTTP status, as its APIs name errors.
_GOOGLE_STATUSES = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    408: "DEADLINE_EXCEEDED",
    409: "ABORTED",
    413: "INVALID_ARGUMENT",
    422: "INVALID_ARGUMENT",
    424: "FAILED_PRECONDITION",
    429: "RESOURCE_EXHAUSTED",
    499: "CANCELLED",
    500: "INTERNAL",
    501: "UNIMPLEMENTED",
    502: "UNAVAILABLE",
    503: "UNAVAILABLE",
    504: "DEADLINE_EXCEEDED",
}


def google_error(*, status: Optional[int], message: str) -> Dict[str, Any]:
    """An error in Google's own shape, for a caller of the native Gemini door.

    `@google/genai` raises a status body of this shape with the message in its text, so the
    code marker the message carries reaches the runner.
    """
    code = status if status is not None else 502
    return {
        "error": {
            "code": code,
            "message": message,
            "status": _GOOGLE_STATUSES.get(code, "UNKNOWN"),
        }
    }

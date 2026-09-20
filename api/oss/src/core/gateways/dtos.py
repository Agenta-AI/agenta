"""Shared DTOs for the LLM and MCP gateway planes.

This module also holds the outbound boundary both planes relay through: which request
headers may reach a tenant-configured upstream, which cookie jar an upstream client is
given, and how a relayed response is checked for the credential the gateway injected.
"""

from enum import Enum
from http.cookiejar import CookieJar
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import httpx
from pydantic import BaseModel, Field


# The request headers that may be forwarded to a tenant-configured upstream. The list is
# deny-by-default on purpose: an upstream URL is tenant data, so anything reaching it is
# disclosed to whoever registered the endpoint. Under the previous allow-by-default strip
# list the caller's Agenta session cookie and Authorization header both travelled upstream,
# and every header added anywhere in the platform joined the forwarded set silently.
#
# Never add here: `authorization`, `cookie`, `x-ag-credentials`, `proxy-authorization`, or
# any `host`/hop-by-hop name. An endpoint's upstream credential comes from its registered
# secret, never from the caller.
FORWARDABLE_REQUEST_HEADERS = frozenset(
    {
        # The body's own description, and what the caller can read back.
        "content-type",
        "accept",
        # Anthropic's Messages API rejects or degrades a request without these.
        "anthropic-version",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
        # OpenAI's routing and opt-in feature headers.
        "openai-organization",
        "openai-project",
        "openai-beta",
        # Streamable HTTP MCP session state: the runner reads `mcp-session-id` off the
        # handshake response and sends it on every later call
        # (services/runner/src/engines/sandbox_agent/mcp-handshake.ts, extensions/pi-mcp.ts).
        "mcp-session-id",
        "mcp-protocol-version",
        # Deduplicates a retried POST. Both vendor SDKs send it, and dropping it turns an
        # SDK-level retry into a second billable call.
        "idempotency-key",
        # Selects a behaviour profile on the in-process mock upstreams, which read it off
        # the request (core/gateways/{llms,mcps}/providers/mock/app.py). Dev-only and not a
        # credential; allowlisted so a harness can drive a profile from the caller side.
        "x-agenta-mock-profile",
    }
)

# Vendor SDK telemetry (`x-stainless-os`, `x-stainless-retry-count`, ...). A prefix rather
# than an enumeration because the set grows with each SDK release.
FORWARDABLE_REQUEST_HEADER_PREFIXES: Tuple[str, ...] = ("x-stainless-",)

# Hop-by-hop and connection-scoped names, plus the platform credential that authenticated
# the caller to us. None is on the allowlist, so this is a second line of defence rather
# than the boundary itself: it keeps holding if the allowlist is ever widened.
NON_FORWARDABLE_REQUEST_HEADERS = frozenset(
    {
        "x-ag-credentials",
        "host",
        "content-length",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "proxy-authenticate",
        "proxy-authorization",
        "cookie",
        "authorization",
    }
)


def is_forwardable_request_header(name: str) -> bool:
    lowered = name.lower()
    if lowered in NON_FORWARDABLE_REQUEST_HEADERS:
        return False
    return lowered in FORWARDABLE_REQUEST_HEADERS or lowered.startswith(
        FORWARDABLE_REQUEST_HEADER_PREFIXES
    )


def forwardable_request_headers(headers: Mapping[str, str]) -> Dict[str, str]:
    """The caller's headers that may travel to a tenant-configured upstream."""
    return {
        name: value
        for name, value in headers.items()
        if is_forwardable_request_header(name)
    }


class NoCookieJar(CookieJar):
    """A jar that never stores an upstream `Set-Cookie` and never sends a `Cookie`.

    One `httpx.AsyncClient` is pooled for the life of the process on the LLM plane, and an
    `httpx` client keeps a cookie jar. Without this, one tenant's upstream session cookie
    is stored on that shared jar and replayed to the next tenant's upstream.
    """

    def extract_cookies(self, response, request) -> None:  # noqa: ARG002
        return None

    def add_cookie_header(self, request) -> None:  # noqa: ARG002
        return None


class NoCookies(httpx.Cookies):
    """`httpx.Cookies` that stores nothing and sends nothing.

    `httpx` rebuilds any `Cookies` it is handed into a fresh object and keeps only a raw
    `CookieJar` (`httpx.Cookies.__init__`), so these two no-ops alone would be discarded by
    the client constructor. The guarantee therefore lives in :class:`NoCookieJar`, and
    clients are handed `NoCookies().jar`; the overrides cover a caller that holds this
    object directly.
    """

    def __init__(self) -> None:
        super().__init__(NoCookieJar())

    def extract_cookies(self, response) -> None:  # noqa: ARG002
        return None

    def set_cookie_header(self, request) -> None:  # noqa: ARG002
        return None


def no_cookie_jar() -> CookieJar:
    """The jar to hand every gateway `httpx` client as `cookies=`."""
    return NoCookies().jar


# Header names whose value is a credential the gateway injected. `Authorization` and the
# two vendor key headers; a custom endpoint's `extras` are configuration, not secrets, so
# they are not scanned for.
_INJECTED_CREDENTIAL_HEADERS = frozenset({"authorization", "x-api-key", "api-key"})

# Below this length a value is too short to identify anything, and scanning for it would
# refuse responses over a coincidence.
_MIN_SCANNED_CREDENTIAL_LENGTH = 8


def injected_credential_values(headers: Mapping[str, str]) -> Tuple[bytes, ...]:
    """The secret values a relayed response must not contain.

    The scheme prefix is dropped (`Bearer sk-x` yields `sk-x`) so an upstream echoing the
    bare key, not the whole header, is still caught.
    """
    values: Dict[bytes, None] = {}
    for name, value in headers.items():
        if name.lower() not in _INJECTED_CREDENTIAL_HEADERS or not value:
            continue
        _, _, remainder = value.partition(" ")
        token = (remainder or value).strip()
        if len(token) >= _MIN_SCANNED_CREDENTIAL_LENGTH:
            values[token.encode()] = None
    return tuple(values)


class CredentialEchoScanner:
    """Detects the injected credential in a relayed response, across chunk boundaries.

    A streamed body arrives in chunks the upstream chose, so a credential can straddle two
    of them. Each chunk is searched together with the tail of the one before it, kept at
    `len(secret) - 1` bytes, which is the longest prefix a split can leave behind.

    Detection alone is enough only where the bytes are read whole before anything is
    relayed: a non-streaming body, an error body, a response's header block. A streamed
    body is relayed as it arrives, so detecting a split value after the first half has
    already been yielded is too late; that path uses :class:`CredentialEchoRelay`.
    """

    def __init__(self, secrets: Sequence[bytes]) -> None:
        self._secrets: Tuple[bytes, ...] = tuple(secrets)
        self._overlap = max((len(secret) for secret in self._secrets), default=1) - 1
        self._carry = b""

    @property
    def active(self) -> bool:
        return bool(self._secrets)

    @property
    def secrets(self) -> Tuple[bytes, ...]:
        return self._secrets

    def contains(self, data: bytes) -> bool:
        """Whether these bytes hold an injected value. Stateless: no carry is kept."""
        return any(secret in data for secret in self._secrets)

    def detects_headers(self, headers: Mapping[str, str]) -> bool:
        """Whether the response's own header block echoes an injected value.

        The body scan never saw this: an upstream that answers 200 with the key in, say,
        `X-Debug-Auth` has that header copied onto Agenta's own response by the proxy's
        `response_headers`, and the caller reads the credential without a byte of the body
        containing it.

        Names and values are scanned as one CRLF-joined block, the way they travelled. An
        injected value cannot itself contain CRLF, so a match always lies inside a single
        header line and joining cannot manufacture one.
        """
        if not self._secrets:
            return False
        block = "\r\n".join(f"{name}: {value}" for name, value in headers.items())
        return self.contains(block.encode(errors="replace"))

    def detects(self, chunk: bytes) -> bool:
        if not self._secrets:
            return False
        window = self._carry + chunk
        found = any(secret in window for secret in self._secrets)
        self._carry = window[-self._overlap :] if self._overlap else b""
        return found


class CredentialEchoDetected(Exception):
    """An injected credential appeared in bytes that were about to be relayed.

    Raised by :class:`CredentialEchoRelay` and translated by the adapter into the typed
    refusal a caller sees; never carries the value itself.
    """


class CredentialEchoRelay:
    """Holds back streamed bytes until they cannot still be the start of the credential.

    Detecting a split value is not the same as containing it. The scanner above notices a
    credential straddling two chunks only once the second chunk arrives, and by then the
    first has been yielded: split a 26-byte key at byte 25 and the caller keeps 25 of it
    with one byte left to guess. So the relay withholds instead of merely watching.

    Each chunk is appended to what is held, the whole buffer is searched, and everything is
    released **except the longest suffix that is still a proper prefix of an injected
    value**. That suffix is the only part that the next chunk can complete into the
    credential; every byte before it is already proven not to start one, so it goes out at
    once. The number withheld is therefore 0 for a stream that does not resemble the
    credential — no stall, no added latency on the normal path — and at most
    `len(secret) - 1` bytes when it does, since a suffix as long as the value would be a
    match and raise rather than be held.

    :meth:`flush` releases the held tail when the body ends: a prefix that reaches the end
    of the stream is a prefix that never completed.
    """

    def __init__(self, secrets: Sequence[bytes]) -> None:
        self._secrets: Tuple[bytes, ...] = tuple(secrets)
        self._pending = b""

    @property
    def held(self) -> int:
        """How many bytes are currently withheld. For assertions and tests."""
        return len(self._pending)

    def release(self, chunk: bytes) -> bytes:
        """The bytes of `chunk` that are safe to relay. Raises `CredentialEchoDetected`."""
        if not self._secrets:
            return chunk

        buffer = self._pending + chunk
        if self._contains(buffer):
            self._pending = b""
            raise CredentialEchoDetected()

        hold = self._unfinished_prefix_length(buffer)
        cut = len(buffer) - hold
        self._pending = buffer[cut:]
        return buffer[:cut]

    def flush(self) -> bytes:
        """The held tail, released because the stream ended without completing a value."""
        pending, self._pending = self._pending, b""
        return pending

    def _contains(self, buffer: bytes) -> bool:
        return any(secret in buffer for secret in self._secrets)

    def _unfinished_prefix_length(self, buffer: bytes) -> int:
        """The longest suffix of `buffer` that is a proper prefix of an injected value."""
        longest = 0
        for secret in self._secrets:
            limit = min(len(secret) - 1, len(buffer))
            for size in range(limit, longest, -1):
                if buffer.endswith(secret[:size]):
                    longest = size
                    break
        return longest


# The `code` a refusal carries when an upstream returned the credential the gateway
# injected. Distinct from `upstream_error`: nothing is wrong with the request, and no retry
# helps until the key is rotated.
CREDENTIAL_ECHO_CODE = "upstream_echoed_credential"

CREDENTIAL_ECHO_MESSAGE = (
    "The upstream response contained the credential the gateway sent it, "
    "so the response was refused rather than relayed."
)

CREDENTIAL_ECHO_NEXT_STEP = (
    "Treat the endpoint's provider key as disclosed: rotate it, then retry."
)


def credential_echo_envelope(*, target: Optional[str] = None) -> Dict[str, Any]:
    """The shared refusal envelope `{code, message, retryable, next_step, details}`.

    Never carries the credential itself: this body reaches the sandbox and the transcript,
    which is the disclosure the refusal exists to prevent.
    """
    envelope: Dict[str, Any] = {
        "code": CREDENTIAL_ECHO_CODE,
        "message": CREDENTIAL_ECHO_MESSAGE,
        "retryable": False,
        "next_step": CREDENTIAL_ECHO_NEXT_STEP,
    }
    if target:
        envelope["details"] = {"target": target}
    return envelope


def outbound_headers(*layers: Optional[Mapping[str, str]]) -> httpx.Headers:
    """Assemble outbound headers case-insensitively, in the order given; the last wins.

    HTTP field names are case-insensitive, so merging plain dicts leaves Starlette's
    lowercase `authorization` beside an injected capital-A `Authorization` and sends both
    upstream, which one the upstream honours being its choice. Each name is assigned rather
    than merged, because assignment replaces every entry with that name whatever its
    casing, even two spellings within one layer.

    Pass the caller's headers through :func:`forwardable_request_headers` first; each plane
    decides where that layer sits relative to its endpoint's configured headers.
    """
    headers = httpx.Headers()
    for layer in layers:
        for name, value in (layer or {}).items():
            headers[name] = value
    return headers


class GatewayAuthScheme(str, Enum):
    """How the gateway authenticates to an upstream."""

    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Connection state for one caller and endpoint."""

    READY = "ready"  # a usable secret exists for this owner
    NEEDS_AUTH = "needs_auth"  # OAuth target with no usable secret; connect
    NEEDS_INPUT = "needs_input"  # a secret must be supplied before use


class GatewayConnectAffordance(BaseModel):
    """Connection action needed to authorize an endpoint."""

    endpoint: str
    body: Dict[str, Any] = Field(default_factory=dict)


class GatewayConnectionRequirement(BaseModel):
    """One target's secret state, returned from discovery and from a refused
    call. `connect` is present exactly when the state is not READY."""

    target: str  # route path under the plane, e.g. "builtin/composio/notion/my-notion"
    state: GatewayConnectionState
    connect: Optional[GatewayConnectAffordance] = None


class GatewayEndpointNamespace(str, Enum):
    """Gateway route namespace."""

    BUILTIN = "builtin"  # our account; a provider segment follows (agenta, composio)
    STANDARD = "standard"  # a known shape, the user's secret; generated, never a row
    CUSTOM = "custom"  # a row; configurable


class GatewayEndpointRoute(BaseModel):
    """Shared non-secret upstream address and headers."""

    base_url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class GatewayEndpointFilter(BaseModel):
    """Allowlist and denylist filter for models or tools."""

    allowlist: Optional[List[str]] = None
    denylist: Optional[List[str]] = None

    def allows(self, name: str) -> bool:
        if self.denylist is not None and name in self.denylist:
            return False
        if self.allowlist is None:
            return True
        return name in self.allowlist

    def enumerate(self) -> List[str]:
        """Return the allowed names that can be listed without upstream discovery."""
        return [name for name in (self.allowlist or []) if self.allows(name)]


class GatewayEndpointSettings(BaseModel):
    """Shared endpoint settings."""

    timeout_seconds: Optional[float] = None

"""The gateway's outbound boundary: the one way both planes reach a tenant-chosen address.

Every call the gateway makes to an address that came from tenant data, or from an upstream's
own response, is built here. :func:`open_egress` resolves the hostname, refuses every
resolved address that falls in a blocked range, pins the connection to the address it
checked, and assembles the outbound headers from the allowlist in
:mod:`oss.src.core.gateways.dtos`. :func:`egress_client` and :func:`harden_pooled_client`
give that request a client that keeps no cookies and follows no redirects.

Why one module (OD26). Registration validates a URL's format and its literal IP
(`core/webhooks/utils.py::validate_url_format_and_literal_ip`) and deliberately defers name
resolution to the point of use. A hostname that registers cleanly can therefore resolve to
an internal address on its first call, and a single-box self-hosted install is exactly where
"internal" is one hop away. The check that closes that gap existed once, in the MCP HTTP
relay, and not on the LLM plane or in the MCP OAuth client; copies that drift are how the
gap appeared in the first place, so there is now one.

The six address predicates stay in `core/webhooks/utils.py`, which webhook delivery already
uses: this module calls :func:`resolve_validated_ip` rather than restating them, so `api/`
holds one copy. (The SDK's `agenta/sdk/utils/net.py` and the runner's `ssrf-guard.ts` are
separate processes with their own copies; unifying those is not this module's job.)

What does *not* come from webhooks is the decision to apply them. `AGENTA_INSECURE_EGRESS_ALLOWED`
defaults to permissive so a zero-config self-host can post a webhook to a box on its own LAN;
a check that is off by default is not a check, and the gateway cannot inherit that answer,
because its targets are tenant data and upstream-supplied URLs dialled with a provider
credential attached. The gateway therefore owns `AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED`
(`env.gateway_egress.insecure_allowed`), which defaults to **false**: the range check and the
https requirement are on unless an operator turns them off deliberately. Webhook delivery is
untouched and still reads its own flag. A dev stack reaches its own containers through the
narrow exemptions in :func:`exempt_hosts`, not by disabling the guard.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Callable, Dict, Mapping, Optional, Set
from urllib.parse import urlparse, urlunparse

import httpx

from oss.src.core.gateways.dtos import (
    forwardable_request_headers,
    no_cookie_jar,
    outbound_headers,
)
from oss.src.core.webhooks.utils import resolve_validated_ip
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class EgressRefusedError(ValueError):
    """The egress boundary refused a target.

    A `ValueError` so a caller that already handles the resolver's own refusals keeps
    working. `unresolvable` separates a DNS typo from a security rejection without anyone
    matching on the message text.
    """

    def __init__(self, *, url: str, detail: str, unresolvable: bool = False) -> None:
        self.url = url
        self.detail = detail
        self.unresolvable = unresolvable
        super().__init__(detail)

    @property
    def relay_detail(self) -> str:
        """The wording an adapter surfaces, keeping a typo distinct from a refusal.

        Mirrors the runner (`services/runner/src/engines/sandbox_agent/mcp.ts`).
        """
        return self.detail if self.unresolvable else f"blocked target: {self.detail}"


@dataclass(frozen=True)
class EgressTarget:
    """A checked, pinned target and the headers that may travel with it."""

    url: str  # the request URL, host swapped for the checked literal address
    headers: httpx.Headers
    extensions: Dict[str, Any] = field(default_factory=dict)
    original_url: str = ""
    pinned_address: Optional[str] = None

    @property
    def pinned(self) -> bool:
        return self.pinned_address is not None


def exempt_hosts() -> Set[str]:
    """Hostnames an operator has taken responsibility for, which skip the guard.

    Two sources, both operator environment and neither reachable from tenant data:

    * `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST` (`env.mcp_gateway.host_allowlist`) is the existing
      escape hatch so a self-hoster can reach one known internal server without disabling the
      guard globally. It mirrors the runner's `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`. The name is
      MCP-specific for historical reasons; both planes honour it now that the boundary is one
      module.
    * The development mock upstreams, and only while `AGENTA_GATEWAYS_MOCKS_ENABLED` is on.
      They are compose services on the private Docker network, so the acceptance suites that
      dial them would otherwise be refused by exactly the check they are meant to leave
      intact. A tenant cannot reach this branch: the flag is operator environment, off by
      default, and the host must equal the one the operator configured in
      `AGENTA_MOCK_LLM_GATEWAY_URL` / `AGENTA_MOCK_MCP_GATEWAY_URL`. A tenant registering
      that same hostname reaches the operator's own mock container and nothing else.
    """
    hosts = {host.strip().lower() for host in env.mcp_gateway.host_allowlist}
    hosts.discard("")

    if env.mock_gateways.enabled:
        for url in (env.mock_gateways.llm_url, env.mock_gateways.mcp_url):
            host = (urlparse(url).hostname or "").lower()
            if host:
                hosts.add(host)

    return hosts


def _pin_to_resolved_address(url: str, address: str) -> tuple[str, str]:
    """Swap the URL host for the literal checked address; return (pinned_url, Host header).

    This is the TOCTOU close: the connection is made to the address the guard just checked,
    so a name that re-resolves between the check and the connect cannot move the request. The
    original authority travels as `Host` (and as the TLS SNI name, set by the caller from
    `extensions`), so the upstream still routes and still presents a certificate for the name
    that was registered.
    """
    parsed = urlparse(url)
    host_literal = f"[{address}]" if ":" in address else address
    pinned_netloc = f"{host_literal}:{parsed.port}" if parsed.port else host_literal
    pinned_url = urlunparse(parsed._replace(netloc=pinned_netloc))

    hostname = parsed.hostname or ""
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port:
        host_header = f"{host_header}:{parsed.port}"

    return pinned_url, host_header


# Name resolution runs on a pool of this module's own, not the loop's default one.
#
# `asyncio.to_thread` hands work to the executor the event loop shares with every other
# offloaded call in the process. `getaddrinfo` blocks with no timeout of its own, so a
# resolver that stops answering parks a worker there for as long as the operating system
# takes to give up, and enough of them starve work that has nothing to do with the
# gateway. Bounding the wait releases the coroutine and does not release the worker, which
# is the part the first attempt at this overstated (M18).
#
# A pool of our own contains that: stuck resolutions can exhaust these threads and nothing
# else. When they do, the wait below fires while queueing rather than while resolving, and
# the caller is told the address could not be resolved in time — which is true, and is the
# same refusal a resolver that never answers produces.
_RESOLVER_THREADS = 8
_RESOLVE_TIMEOUT_SECONDS = 5.0

_resolver_pool: Optional[ThreadPoolExecutor] = None


def _resolver_executor() -> ThreadPoolExecutor:
    global _resolver_pool
    if _resolver_pool is None:
        _resolver_pool = ThreadPoolExecutor(
            max_workers=_RESOLVER_THREADS, thread_name_prefix="gateway-resolver"
        )
    return _resolver_pool


async def resolve_offloaded(
    resolve: Callable[[], Any],
    *,
    timeout: Optional[float] = None,
) -> Any:
    """Run one blocking resolution off the event loop, with a bound on the wait.

    Raises `TimeoutError` when the bound fires. Every caller turns that into its own
    refusal, because what "could not resolve in time" means differs: a relay cannot
    proceed, and the registration check has a conservative answer it can give.
    """
    loop = asyncio.get_running_loop()
    # Read here rather than bound as a default, so the module constant is the value in
    # force and a case can pin it without rewriting the signature.
    bound = _RESOLVE_TIMEOUT_SECONDS if timeout is None else timeout
    async with asyncio.timeout(bound):
        return await loop.run_in_executor(_resolver_executor(), resolve)


async def open_egress(
    url: str,
    *,
    caller_headers: Optional[Mapping[str, str]] = None,
    beneath_caller: Optional[Mapping[str, str]] = None,
    above_caller: Optional[Mapping[str, str]] = None,
) -> EgressTarget:
    """Check, pin and dress one outbound call. Raises :class:`EgressRefusedError`.

    `caller_headers` are the request headers of whoever called the gateway. They are always
    reduced to the allowlist in `core/gateways/dtos.py` before they travel, so no call site
    can forward them whole. `beneath_caller` and `above_caller` are the gateway's own layers;
    the planes disagree about where the caller sits (the MCP relay lets a caller override an
    endpoint header, the LLM relay does not), so the order is the call site's to state, while
    what is admitted at all is not.
    """
    headers = outbound_headers(
        beneath_caller,
        forwardable_request_headers(caller_headers or {}),
        above_caller,
    )

    hostname = (urlparse(url).hostname or "").lower()
    if hostname and hostname in exempt_hosts():
        return EgressTarget(url=url, headers=headers, original_url=url)

    try:
        # getaddrinfo blocks, and both relay planes are on the request path. The flag is
        # read per call, not captured at import, so an operator's value is the one in force
        # and a test can pin it.
        address = await resolve_offloaded(
            partial(
                resolve_validated_ip,
                url,
                allow_insecure=env.gateway_egress.insecure_allowed,
                label="Upstream URL",
            )
        )
    except TimeoutError as exc:
        # Refused rather than awaited. This runs on the relay path every gateway call
        # takes, and it had no bound at all: one address whose resolver hangs held a
        # request open for as long as the resolver did (M18).
        log.warning(
            "[gateways] resolving an upstream address timed out",
            timeout=_RESOLVE_TIMEOUT_SECONDS,
        )
        raise EgressRefusedError(
            url=url,
            detail="the address could not be resolved in time",
            unresolvable=True,
        ) from exc
    except ValueError as exc:
        message = str(exc)
        raise EgressRefusedError(
            url=url,
            detail=message,
            unresolvable="could not be resolved" in message,
        ) from exc

    pinned_url, host_header = _pin_to_resolved_address(url, address)
    headers["Host"] = host_header

    return EgressTarget(
        url=pinned_url,
        headers=headers,
        # Without this the TLS handshake would use the literal address and every
        # certificate would fail to verify.
        extensions={"sni_hostname": urlparse(url).hostname},
        original_url=url,
        pinned_address=address,
    )


def egress_client(
    *,
    timeout: Optional[float] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> httpx.AsyncClient:
    """A client for one outbound gateway call: no cookies, no redirects.

    Redirects are never followed: a 302 is the upstream re-pointing the request at a host
    nothing checked, which would undo the pin above. A caller that wants to follow one must
    take the new location back through :func:`open_egress`.
    """
    return httpx.AsyncClient(
        timeout=timeout,
        transport=transport,
        cookies=no_cookie_jar(),
        follow_redirects=False,
    )


def harden_pooled_client(client: httpx.AsyncClient) -> httpx.AsyncClient:
    """Apply the same two rules to a client pooled across calls.

    The LLM relay keeps one client for the life of the process (a streaming response outlives
    the method that opened it), so it cannot use :func:`egress_client` per call. Assigned
    rather than passed to a constructor so an injected client is covered too.
    """
    client.cookies = no_cookie_jar()
    client.follow_redirects = False
    return client


# --- reading a streamed response without lying about what was read ------------- #

# Headers that describe the body as it travelled, not the bytes a caller now holds.
# `aiter_bytes` yields DECODED bytes, so carrying these forward tells the next reader to
# decode what is already decoded: a gzip-encoded document came back as a `DecodingError`
# the moment anything touched `.content`, and every real MCP server compresses. The mock
# upstreams do not, which is why nothing here caught it.
_ENCODED_BODY_HEADERS = ("content-encoding", "content-length", "transfer-encoding")


def decoded_response(response: httpx.Response, body: bytes) -> httpx.Response:
    """Rebuild a streamed response around the bytes that were actually read.

    Callers that cap a response read it themselves and cannot hand the original object
    on, because its stream is spent. This gives them one that carries the same status and
    the same meaningful headers over the decoded bytes, with the three that would
    misdescribe them removed. `content-type` is kept: it is what tells a reader whether
    the payload is JSON or an event stream.
    """
    headers = httpx.Headers(response.headers)
    for name in _ENCODED_BODY_HEADERS:
        if name in headers:
            del headers[name]
    return httpx.Response(
        status_code=response.status_code, headers=headers, content=body
    )


# --- how an outbound call failed, without quoting the failure ------------------ #

# `str(httpx.RequestError)` is not safe to show a caller. h11 validates the request we
# built, and its refusal quotes the offending bytes: a stored credential whose value
# carries a byte h11 rejects — a trailing newline on a pasted key is the ordinary way to
# get one — comes back as `Illegal header value b'Bearer <the key>'`. Nine call sites
# across both planes copied that text onto a caller-visible `detail`, so the relay handed
# the sandbox the credential it was refusing to send (OR86).
#
# The exception is therefore never quoted. It is classified into this closed vocabulary,
# and the caller gets the sentence beside it. Each entry also says whether the exception's
# own text may be logged: an application log is not a caller, but it is not a vault either,
# and two of these classes quote bytes we built or bytes an upstream returned.
_TRANSPORT_FAILURES: tuple = (
    # (exception class, cause, caller-visible sentence, text safe to log)
    (
        httpx.TimeoutException,
        "timeout",
        "The upstream did not answer in time.",
        True,
    ),
    (
        httpx.LocalProtocolError,
        "request_rejected",
        "The request could not be sent to the upstream. Check the connection's stored "
        "credential and headers for stray characters.",
        # h11's message quotes the header or body bytes it refused, which is exactly the
        # credential. Never logged, not even server-side.
        False,
    ),
    (
        httpx.RemoteProtocolError,
        "protocol_error",
        "The upstream did not speak HTTP correctly.",
        # Quotes bytes the upstream sent, which may echo what it was sent.
        False,
    ),
    (
        httpx.ProxyError,
        "proxy_error",
        "The proxy refused the connection to the upstream.",
        True,
    ),
    (
        httpx.UnsupportedProtocol,
        "unsupported_protocol",
        "The upstream address does not name a protocol the gateway can speak.",
        True,
    ),
    (
        httpx.ConnectError,
        "connect_error",
        "The upstream could not be reached.",
        True,
    ),
    (
        httpx.TooManyRedirects,
        "too_many_redirects",
        "The upstream redirected too many times.",
        True,
    ),
    # The remaining `TransportError` leaves: ReadError, WriteError, CloseError. Their text
    # is an OS-level socket message, but they are the catch-all rather than a named case,
    # so they are not logged verbatim either.
    (
        httpx.RequestError,
        "transport_error",
        "The gateway could not complete the request to the upstream.",
        False,
    ),
)


@dataclass(frozen=True)
class UpstreamTransportFailure:
    """A transport failure, described without quoting the exception.

    `detail` is caller-visible and is one of a closed set of sentences; it never contains
    the exception's text, the request's headers or the request's body.
    """

    cause: str
    detail: str


def classify_transport_error(exc: httpx.RequestError) -> UpstreamTransportFailure:
    """Describe an `httpx.RequestError` for a caller, and log what is safe to log.

    Call this instead of `str(exc)` at every site that turns a transport failure into an
    error a caller reads. The exception itself stays available through `raise ... from exc`
    for anything that inspects the chain in-process.
    """
    for kind, cause, detail, loggable in _TRANSPORT_FAILURES:
        if isinstance(exc, kind):
            if loggable:
                log.warning(
                    "[gateways] upstream transport failure",
                    cause=cause,
                    error_class=type(exc).__name__,
                    error=str(exc),
                )
            else:
                # The class and the cause only. The text may quote the credential.
                log.warning(
                    "[gateways] upstream transport failure",
                    cause=cause,
                    error_class=type(exc).__name__,
                )
            return UpstreamTransportFailure(cause=cause, detail=detail)
    raise AssertionError(  # pragma: no cover - the table ends at `RequestError`
        f"unclassified transport error: {type(exc).__name__}"
    )

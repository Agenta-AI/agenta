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
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Dict, Mapping, Optional, Set
from urllib.parse import urlparse, urlunparse

import httpx

from oss.src.core.gateways.dtos import (
    forwardable_request_headers,
    no_cookie_jar,
    outbound_headers,
)
from oss.src.core.webhooks.utils import resolve_validated_ip
from oss.src.utils.env import env


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
        address = await asyncio.to_thread(
            partial(
                resolve_validated_ip,
                url,
                allow_insecure=env.gateway_egress.insecure_allowed,
                label="Upstream URL",
            )
        )
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

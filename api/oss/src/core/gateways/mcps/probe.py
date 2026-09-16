"""Read-only inspection of a URL a person has typed, before any endpoint row exists.

The connect journey asks for a server URL first and has to say something true about it
before asking for anything else: is it reachable, what does it call itself, and does it
want OAuth. Nothing here creates, edits or reads a row, and nothing here accepts or sends
a credential — there is no endpoint to carry one, and a credential must never be sent to
an origin that has not been chosen yet.

Two protocol facts shape the order of the checks:

* `initialize` is the MCP handshake's first call and the only one that reports
  `serverInfo`. It is not a tool call and has no side effect, so it is the safe probe.
* A server that requires authorization answers the unauthenticated handshake with a 401
  naming its protected-resource document (RFC 9728 s5.1). That challenge, not a guess, is
  what starts OAuth discovery.

`UNKNOWN` is a real answer and the reason this returns a mode rather than a boolean. A
timeout, an unparseable metadata document and a refused registration are not evidence that
a server wants an API key, and offering a key field on that evidence asks a person to paste
a credential into a form that may have no use for it.
"""

import asyncio
import json
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel

from oss.src.core.gateways.egress import (
    EgressRefusedError,
    classify_transport_error,
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.registration import is_publicly_resolvable
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthDiscoveryError


class _ResponseTooLarge(Exception):
    """The server sent more than a handshake can be. Never reaches a caller."""


_TIMEOUT_SECONDS = 10.0

# A total elapsed deadline for the handshake, and a cap on what is read back.
#
# The client's timeout is an inactivity timeout: a server that sends one byte just inside
# it keeps a worker occupied for as long as it likes, and the body was buffered whole
# before anything looked at it, so its size was the server's choice too. The address is
# tenant data, so both are somebody else's number unless they are bounded here (D38).
#
# A handshake result is a few kilobytes. The cap is generous against that, and small
# enough that a hostile or broken server cannot spend the process's memory; the deadline
# is twice the inactivity timeout, so an ordinary slow server still completes.
_DEADLINE_SECONDS = 20.0
_MAX_RESPONSE_BYTES = 1 * 1024 * 1024

# The version this branch speaks. A server that answers a different one still answers,
# and the reported value is what the journey shows.
_PROTOCOL_VERSION = "2025-06-18"

_CLIENT_INFO = {"name": "agenta-connect-probe", "version": "1"}


class MCPProbeAuthMode(str, Enum):
    """What the server asked for, as far as the probe could establish."""

    NONE = "none"
    OAUTH = "oauth"
    UNKNOWN = "unknown"


class MCPProbeRegistration(str, Enum):
    """How this deployment would register itself with the discovered issuer."""

    DYNAMIC = "dynamic"
    METADATA = "metadata"
    UNAVAILABLE = "unavailable"


class MCPProbeProblem(BaseModel):
    """Why the probe could not answer. `cause` is for branching, `message` for a person."""

    cause: str
    message: str


class MCPProbeAuth(BaseModel):
    mode: MCPProbeAuthMode = MCPProbeAuthMode.UNKNOWN
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = []
    registration: Optional[MCPProbeRegistration] = None


class MCPServerProbeResult(BaseModel):
    """Everything the probe learned. No identity, because it created nothing."""

    reachable: bool = False
    server_name: Optional[str] = None
    protocol_version: Optional[str] = None
    auth: MCPProbeAuth = MCPProbeAuth()
    problem: Optional[MCPProbeProblem] = None


def _initialize_request() -> bytes:
    return json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": _CLIENT_INFO,
            },
        }
    ).encode()


def _initialize_result(response: httpx.Response) -> Optional[Dict[str, Any]]:
    """The handshake's `result`, or `None` when the body is not one.

    A Streamable HTTP server may answer the handshake as a single SSE event rather than a
    JSON body, so the payload is read out of the last `data:` line when it is.
    """
    body = response.content
    if not body:
        return None

    media_type = (response.headers.get("content-type") or "").split(";")[0].strip()
    if media_type == "text/event-stream":
        data_lines = [
            line[len("data:") :].strip()
            for line in body.decode("utf-8", "replace").splitlines()
            if line.startswith("data:")
        ]
        if not data_lines:
            return None
        body = data_lines[-1].encode()

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    return result if isinstance(result, dict) else None


class MCPServerProbe:
    def __init__(
        self,
        *,
        oauth_client: MCPOAuthClient,
        api_url: str,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self.oauth_client = oauth_client
        self.api_url = api_url
        # Injectable seam for tests, matching MCPOAuthClient / HttpMCPAdapter.
        self._transport = transport

    async def _handshake(self, target) -> httpx.Response:
        """Send the handshake and read at most `_MAX_RESPONSE_BYTES` of the answer.

        Streamed rather than buffered so the cap is applied while the bytes arrive
        instead of after they have all been accepted. The bytes that were read are
        returned as an ordinary response, so everything downstream parses the handshake
        the way it always has.
        """
        async with egress_client(
            timeout=_TIMEOUT_SECONDS, transport=self._transport
        ) as client:
            request = client.build_request(
                "POST",
                target.url,
                content=_initialize_request(),
                headers={
                    **target.headers,
                    "content-type": "application/json",
                    "accept": "application/json, text/event-stream",
                },
                extensions=target.extensions,
            )
            response = await client.send(request, stream=True)
            try:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > _MAX_RESPONSE_BYTES:
                        raise _ResponseTooLarge()
            finally:
                await response.aclose()

        return httpx.Response(
            status_code=response.status_code,
            headers=response.headers,
            content=bytes(body),
        )

    async def probe(self, *, server_url: str) -> MCPServerProbeResult:
        """Inspect `server_url`. Never raises for a server that behaves badly."""
        try:
            target = await open_egress(server_url)
        except EgressRefusedError as e:
            return MCPServerProbeResult(
                problem=MCPProbeProblem(
                    cause="address_refused",
                    message=e.relay_detail,
                )
            )

        try:
            async with asyncio.timeout(_DEADLINE_SECONDS):
                response = await self._handshake(target)
        except _ResponseTooLarge:
            return MCPServerProbeResult(
                reachable=True,
                problem=MCPProbeProblem(
                    cause="not_an_mcp_server",
                    message=(
                        "The address answered with more data than an MCP handshake "
                        "should return, so it was not read."
                    ),
                ),
            )
        except TimeoutError:
            return MCPServerProbeResult(
                problem=MCPProbeProblem(
                    cause="unreachable",
                    message=(
                        "The server did not finish answering in time. It may be "
                        "responding too slowly to be usable."
                    ),
                )
            )
        except httpx.RequestError as e:
            # The probe's message is shown in the connect dialog, so it carries the
            # classified sentence rather than the exception's text (OR86).
            failure = classify_transport_error(e)
            return MCPServerProbeResult(
                problem=MCPProbeProblem(
                    cause="unreachable",
                    message=f"The server did not answer. {failure.detail}",
                )
            )

        # The server answered something, so it exists. What it answered decides the rest.
        if response.status_code in (401, 403):
            return await self._challenged(server_url=server_url)

        result = _initialize_result(response)
        if result is None:
            return MCPServerProbeResult(
                reachable=True,
                problem=MCPProbeProblem(
                    cause="not_an_mcp_server",
                    message=(
                        "The address answered, but not with an MCP handshake "
                        f"(HTTP {response.status_code})."
                    ),
                ),
            )

        server_info = result.get("serverInfo")
        name = server_info.get("name") if isinstance(server_info, dict) else None
        version = result.get("protocolVersion")

        return MCPServerProbeResult(
            reachable=True,
            server_name=name if isinstance(name, str) and name else None,
            protocol_version=version if isinstance(version, str) else None,
            auth=MCPProbeAuth(mode=MCPProbeAuthMode.NONE),
        )

    async def _challenged(self, *, server_url: str) -> MCPServerProbeResult:
        """A server that refused the anonymous handshake. Ask it how to authorize."""
        try:
            discovery = await self.oauth_client.discover(server_url=server_url)
        except MCPOAuthDiscoveryError as e:
            # The server wants something. It did not say what in a form we support, and a
            # 401 alone is not evidence of an API key, so the journey offers its manual
            # fallback with this sentence rather than a credential field by default.
            return MCPServerProbeResult(
                reachable=True,
                problem=MCPProbeProblem(
                    cause="auth_undiscoverable",
                    message=(
                        "The server requires authorization but did not publish an OAuth "
                        f"configuration we could read: {e.detail or 'no metadata found'}."
                    ),
                ),
            )

        return MCPServerProbeResult(
            reachable=True,
            auth=MCPProbeAuth(
                mode=MCPProbeAuthMode.OAUTH,
                authorization_server=discovery.authorization_server,
                scopes_offered=discovery.scopes_offered,
                registration=self._registration(discovery.registration_endpoint),
            ),
        )

    def _registration(
        self, registration_endpoint: Optional[str]
    ) -> MCPProbeRegistration:
        """Which client-identity strategy this deployment would use.

        Mirrors `MCPOAuthConnectService._resolve_client_info`, so a person is told before
        consent what that method would discover at the point of no return: an issuer with
        no dynamic registration is unusable from a deployment the issuer cannot reach.
        """
        if registration_endpoint:
            return MCPProbeRegistration.DYNAMIC
        if is_publicly_resolvable(self.api_url):
            return MCPProbeRegistration.METADATA
        return MCPProbeRegistration.UNAVAILABLE

"""Read-only inspection of a URL a person has typed, before any endpoint row exists.

The connect journey asks for a server URL first and has to say something true about it
before asking for anything else: is it reachable, what does it call itself, and does it
want OAuth. Nothing here creates, edits or reads a row, and nothing here sends a credential
in a header — there is no endpoint to carry one, and a credential must never be sent to an
origin that has not been chosen yet.

An address whose path holds `{secret}` (Firecrawl `/{secret}/v2/mcp`) is the one case that
carries a credential, because without its key that address does not exist. The person
chose that origin and the secret together, the value goes only in the path of the requests
sent to it, no OAuth discovery runs, and everything returned is redacted of it.

Two protocol facts shape the order of the checks:

* `initialize` is the MCP handshake's first call and the only one that reports
  `serverInfo`. It is not a tool call and has no side effect, so it is the safe probe.
  `tools/list` follows it, also without side effect, because a server may accept the
  handshake from anyone and refuse the list.
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
import re
from dataclasses import replace
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import httpx
from pydantic import BaseModel

from oss.src.core.gateways.egress import (
    EgressRefusedError,
    classify_transport_error,
    decoded_response,
    egress_client,
    open_egress,
)
from oss.src.core.gateways.mcps.dtos import MCPCredentialBinding
from oss.src.core.gateways.mcps.echo import (
    redact_credentials,
    url_credentials,
    url_value_forms,
)
from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthDiscovery
from oss.src.core.gateways.mcps.oauth.registration import (
    callback_redirect_uri,
    is_publicly_resolvable_async,
)
from oss.src.core.gateways.mcps.oauth.types import MCPOAuthDiscoveryError
from oss.src.core.gateways.mcps.providers.http.adapter import (
    InjectedCredentials,
    bound_credentials,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class _ResponseTooLarge(Exception):
    """The server sent more than a handshake can be. Never reaches a caller."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__()
        # What was read before the cap, so the refusal can still show its start.
        self.response = response


_TIMEOUT_SECONDS = 10.0

# One elapsed deadline for the whole probe, and a cap on what is read back.
#
# The client's timeout is an inactivity timeout: a server that sends one byte just inside
# it keeps a worker occupied for as long as it likes, and the body was buffered whole
# before anything looked at it, so its size was the server's choice too. The address is
# tenant data, so both are somebody else's number unless they are bounded here (D38).
#
# A handshake result is a few kilobytes. The cap is generous against that, and small
# enough that a hostile or broken server cannot spend the process's memory; the deadline
# is twice the inactivity timeout, so an ordinary slow server still completes.
#
# The whole probe shares the deadline: name resolution, the handshake, the discovery a
# challenge starts, and the registration check. The browser's own bound
# (`PROBE_TIMEOUT_MS` in `web/packages/agenta-entities`) sits just above it.
_DEADLINE_SECONDS = 20.0
_MAX_RESPONSE_BYTES = 1 * 1024 * 1024

# The most of an upstream body a refusal carries back to the person connecting.
_EXCERPT_BYTES = 2 * 1024

# The version this branch speaks. A server that answers a different one still answers,
# and the reported value is what the journey shows.
_PROTOCOL_VERSION = "2025-06-18"

_CLIENT_INFO = {"name": "agenta-connect-probe", "version": "1"}

# How long the legacy-transport check waits for a stream to open. A server on that transport
# answers the GET at once, and the check only runs after the handshake already failed.
_EVENT_STREAM_TIMEOUT_SECONDS = 5.0

_UNSUPPORTED_TRANSPORT_MESSAGE = (
    "This address uses the older SSE transport, which Agenta does not support. "
    "Many providers serve the newer transport at an address ending in /mcp. "
    "Check the provider's docs."
)


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


class MCPProbeResponse(BaseModel):
    """What the server answered, for a person to read: its status and the start of its body.

    Credentials the URL carried are removed from the body before it is cut to length.
    """

    status: int
    body: str


class MCPProbeProblem(BaseModel):
    """Why the probe could not answer. `cause` is for branching, `message` for a person."""

    cause: str
    message: str
    # How the outbound attempt failed, when it failed rather than answered: a cause from
    # `classify_transport_error`'s closed vocabulary, or `unresolvable` for a name that never
    # resolved. `cause` is deliberately coarse — a person connecting a server is
    # told "unreachable" whether the address refused the connection or answered something
    # unreadable — but those two are not the same thing to anything that has to decide
    # whether the deployment has outbound access at all. The real-server acceptance case
    # skips on a connection that never opened and fails on an answer that could not be read,
    # and without this it could only tell them apart by matching the sentence above (D80).
    transport: Optional[str] = None
    # The server's own answer, when something answered. Absent when nothing did.
    response: Optional[MCPProbeResponse] = None


class MCPProbeAuth(BaseModel):
    mode: MCPProbeAuthMode = MCPProbeAuthMode.UNKNOWN
    authorization_server: Optional[str] = None
    scopes_offered: List[str] = []
    registration: Optional[MCPProbeRegistration] = None
    # What the server said when it refused the anonymous handshake, carried on every answer
    # that a challenge produced. OAuth carries it too: a person may pick an API key over
    # OAuth, and the key screen then names the scheme from it.
    #
    # `UNKNOWN` reaches the connect journey as the API-key screen, which asks for a header
    # name. Everything the probe knew about which header that is used to be discarded here,
    # so the screen could only offer its placeholder and a person had to guess from a
    # sentence. These two fields are evidence, not advice: the status the server answered
    # with, and the authentication schemes it named in `WWW-Authenticate`. A challenge that
    # named no scheme reports none rather than a guessed one.
    challenge_status: Optional[int] = None
    challenge_schemes: List[str] = []
    # Where the authorization server sends the browser back, for a person registering
    # an OAuth app of their own with the provider. Set on OAuth answers.
    redirect_uri: Optional[str] = None


class MCPServerProbeResult(BaseModel):
    """Everything the probe learned. No identity, because it created nothing."""

    reachable: bool = False
    server_name: Optional[str] = None
    protocol_version: Optional[str] = None
    auth: MCPProbeAuth = MCPProbeAuth()
    problem: Optional[MCPProbeProblem] = None
    # The address follows the legacy HTTP+SSE convention but refused before anything could
    # prove which transport it speaks. A warning for the next screen, never a verdict: a
    # Streamable HTTP server may live at such an address too.
    legacy_transport_suspected: bool = False


_INITIALIZE_REQUEST = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": _PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": _CLIENT_INFO,
    },
}
_INITIALIZED_NOTIFICATION = {
    "jsonrpc": "2.0",
    "method": "notifications/initialized",
    "params": {},
}
_TOOLS_LIST_REQUEST = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}


def _event_payload(event: str) -> str:
    """One SSE event's payload: its `data:` lines joined, as the transport specifies."""
    data_lines = [
        line[len("data:") :].strip()
        for line in event.splitlines()
        if line.startswith("data:")
    ]
    return "\n".join(data_lines) if data_lines else event.strip()


def _media_type(response: httpx.Response) -> str:
    return (response.headers.get("content-type") or "").split(";")[0].strip().lower()


def _names_legacy_event_stream(server_url: str) -> bool:
    """Whether the address ends in an `/sse` segment, the legacy HTTP+SSE convention."""
    return httpx.URL(server_url).path.rstrip("/").endswith("/sse")


def _initialize_result(response: httpx.Response) -> Optional[Dict[str, Any]]:
    """The handshake's `result`, or `None` when the body is not one.

    A Streamable HTTP server may answer the handshake as an SSE stream rather than a JSON
    body, and that stream may carry MORE THAN ONE event: the transport lets a server send
    notifications before the response. So the answer is the last event carrying a `result`
    or an `error`, not the last event and not every `data:` line joined together (D63).

    Reading the last line alone happened to work against a notification sent FIRST and would
    have failed against one sent after, or against a payload split across two `data:` lines.
    The same selection is made by the Pi client's `readMcpResponseJson` and by the browser
    client's `readJsonRpcPayload`; this is the third of the three and must agree with them.
    """
    body = response.content
    if not body:
        return None

    if _media_type(response) == "text/event-stream":
        text = body.decode("utf-8", "replace").strip()
        frames = [
            payload
            for payload in (
                _event_payload(event) for event in re.split(r"\r?\n\r?\n", text)
            )
            if payload
        ]
        answer = None
        for frame in frames:
            try:
                parsed = json.loads(frame)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            # A notification carries neither, and is owed to no request.
            if isinstance(parsed, dict) and ("result" in parsed or "error" in parsed):
                answer = frame
        if answer is None:
            return None
        body = answer.encode()

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    return result if isinstance(result, dict) else None


def _excerpt(
    response: httpx.Response, *, credentials: Tuple[bytes, ...]
) -> MCPProbeResponse:
    body = redact_credentials(response.content, credentials)
    return MCPProbeResponse(
        status=response.status_code,
        body=body[:_EXCERPT_BYTES].decode("utf-8", "replace"),
    )


def _challenge_schemes(response: httpx.Response) -> List[str]:
    """The authentication schemes a `WWW-Authenticate` header names, in the order given.

    RFC 9110 s11.6.1 makes the header a list of challenges, each a scheme token followed
    by parameters, and a server may send several. Only the scheme tokens are read: the
    parameters are the challenge's own vocabulary and mean different things per scheme,
    while the token is the one part every challenge has.

    Case is preserved as sent, because this is shown to a person rather than compared.
    Quoted parameter values are emptied first: a comma inside one (`realm="a,b"`) does not
    separate challenges.
    """
    header = response.headers.get("WWW-Authenticate") or ""
    header = re.sub(r'"(?:[^"\\]|\\.)*"', '""', header)
    schemes: List[str] = []
    for challenge in header.split(","):
        token = challenge.strip().split(" ", 1)[0].strip()
        # A continuation of the previous challenge's parameters, not a new scheme.
        if not token or "=" in token:
            continue
        if token not in schemes:
            schemes.append(token)
    return schemes


def _unsupported_transport(
    response: httpx.Response, *, credentials: Tuple[bytes, ...]
) -> MCPServerProbeResult:
    return MCPServerProbeResult(
        reachable=True,
        problem=MCPProbeProblem(
            cause="unsupported_transport",
            message=_UNSUPPORTED_TRANSPORT_MESSAGE,
            response=_excerpt(response, credentials=credentials),
        ),
    )


def _redacted(
    result: MCPServerProbeResult, credentials: Tuple[bytes, ...]
) -> MCPServerProbeResult:
    """`result` with every credential removed from each field the server could write."""

    def clean(text: Optional[str]) -> Optional[str]:
        if not text:
            return text
        return redact_credentials(text.encode(), credentials).decode()

    auth = result.auth.model_copy(
        update={
            "authorization_server": clean(result.auth.authorization_server),
            "scopes_offered": [clean(s) for s in result.auth.scopes_offered],
            "challenge_schemes": [clean(s) for s in result.auth.challenge_schemes],
        }
    )
    problem = result.problem
    if problem is not None:
        response = problem.response
        problem = problem.model_copy(
            update={
                "message": clean(problem.message),
                "response": response.model_copy(update={"body": clean(response.body)})
                if response is not None
                else None,
            }
        )
    return result.model_copy(
        update={
            "server_name": clean(result.server_name),
            "protocol_version": clean(result.protocol_version),
            "auth": auth,
            "problem": problem,
        }
    )


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

    async def _post(
        self,
        target,
        message: Dict[str, Any],
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        """Send one JSON-RPC message and read at most `_MAX_RESPONSE_BYTES` of the answer.

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
                content=json.dumps(message).encode(),
                headers={
                    **target.headers,
                    **(headers or {}),
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
                        raise _ResponseTooLarge(decoded_response(response, bytes(body)))
            finally:
                await response.aclose()

        # Rebuilt without the headers that describe the encoded body; see
        # `decoded_response`. The handshake's own `content-type` is kept, because it is
        # what says whether the answer is JSON or a single SSE event.
        return decoded_response(response, bytes(body))

    async def _refused_tool_list(
        self, target, handshake: httpx.Response
    ) -> Optional[httpx.Response]:
        """The server's refusal of `tools/list` after a handshake it accepted, or `None`.

        Some servers answer `initialize` to anyone and check authorization on the first
        real request. A connection is working when it lists its tools, so the probe asks
        for them the way the browser's `listMcpTools` does, on the same session and with
        the same credential, and reads only a refusal. A tool list too large to read was
        not refused.
        """
        result = _initialize_result(handshake) or {}
        version = result.get("protocolVersion")
        headers = {
            "mcp-protocol-version": version
            if isinstance(version, str) and version
            else _PROTOCOL_VERSION
        }
        session = handshake.headers.get("mcp-session-id")
        if session:
            headers["mcp-session-id"] = session
        try:
            # Best effort: a server that needed the notification says so on the list.
            await self._post(target, _INITIALIZED_NOTIFICATION, headers)
        except (httpx.HTTPError, _ResponseTooLarge):
            pass
        try:
            listed = await self._post(target, _TOOLS_LIST_REQUEST, headers)
        except _ResponseTooLarge:
            return None
        return listed if listed.status_code in (401, 403) else None

    async def probe(
        self,
        *,
        server_url: str,
        secret: Optional[str] = None,
        binding: Optional[MCPCredentialBinding] = None,
    ) -> MCPServerProbeResult:
        """Inspect `server_url`. Never raises for a server that behaves badly.

        `secret` is an API key, sent where `binding` says, the way the relay would send
        it. It fills a `{secret}` address, and checks a key before a connection saves it.

        The promise in that sentence is the reason for the outer guard: this is the first
        thing a person's typed address touches, and the connect dialog has a place to show
        a problem and no place to show a stack trace. An unhandled exception here reached
        them as a 500 with no cause, which is how a body the gateway could not decode
        presented itself before that was fixed at the source.
        """
        sent = bound_credentials(binding, secret) if secret else None
        # What the answer is cleaned of: the URL's own query values, and the key in every
        # form it was sent.
        credentials = url_credentials(server_url) + url_value_forms(
            [secret, *sent.headers.values(), *sent.url_values] if sent else []
        )
        try:
            result = await self._probe(
                server_url=server_url, sent=sent, credentials=credentials
            )
        except httpx.HTTPError as e:
            # Every transport and protocol failure httpx raises, including the decoding
            # ones that are not raised until a body is touched.
            failure = (
                classify_transport_error(e)
                if isinstance(e, httpx.RequestError)
                else None
            )
            log.warning(
                "[gateways] probe failed with an unhandled transport error",
                error_class=type(e).__name__,
            )
            return MCPServerProbeResult(
                problem=MCPProbeProblem(
                    cause="unreachable",
                    message=(
                        f"The server did not answer usably. {failure.detail}"
                        if failure is not None
                        else "The server's answer could not be read."
                    ),
                    transport=failure.cause if failure is not None else None,
                )
            )
        # A server that was sent a key can write it into any field it answers with, not
        # only into a body that becomes an excerpt.
        return _redacted(result, credentials) if sent else result

    async def _probe(
        self,
        *,
        server_url: str,
        sent: Optional[InjectedCredentials],
        credentials: Tuple[bytes, ...],
    ) -> MCPServerProbeResult:
        deadline = asyncio.get_running_loop().time() + _DEADLINE_SECONDS
        try:
            async with asyncio.timeout_at(deadline):
                # Checked with the placeholder, which sits in the path and so cannot move
                # the host, and without the key, which is added only to what is sent.
                target = await open_egress(server_url)
                if sent:
                    headers = httpx.Headers(target.headers)
                    headers.update(sent.headers)
                    target = replace(
                        target, url=str(sent.request_url(target.url)), headers=headers
                    )
                response = await self._post(target, _INITIALIZE_REQUEST)
                if response.is_success and _initialize_result(response) is not None:
                    # A refusal here is answered as if the handshake had been refused.
                    response = (
                        await self._refused_tool_list(target, response) or response
                    )
        except EgressRefusedError as e:
            return MCPServerProbeResult(
                problem=MCPProbeProblem(
                    cause="address_refused",
                    # `detail`, not `relay_detail`: the cause already says it was refused,
                    # and a person reads this message in the connect sheet as is.
                    message=e.detail,
                    # A name that did not resolve is how a deployment with no outbound
                    # network fails first, before any connection is attempted. A refusal
                    # by the address checks is a different thing entirely and names no
                    # transport, so nothing can read it as an absent network.
                    transport=(
                        "unresolvable"
                        if e.unresolvable
                        else "saturated"
                        if e.saturated
                        else None
                    ),
                )
            )
        except _ResponseTooLarge as e:
            return MCPServerProbeResult(
                reachable=True,
                problem=MCPProbeProblem(
                    cause="not_an_mcp_server",
                    message=(
                        "The address answered with more data than an MCP handshake "
                        "should return, so it was not read."
                    ),
                    response=_excerpt(e.response, credentials=credentials),
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
                    transport="timeout",
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
                    transport=failure.cause,
                )
            )

        # The server answered something, so it exists. What it answered decides the rest.
        if response.status_code in (401, 403) and sent:
            # The server refused the key it was sent. Discovery is not run: it follows
            # addresses the server names, and those can carry the key to another origin.
            return MCPServerProbeResult(
                reachable=True,
                auth=MCPProbeAuth(
                    mode=MCPProbeAuthMode.UNKNOWN,
                    challenge_status=response.status_code,
                    challenge_schemes=_challenge_schemes(response),
                ),
            )

        if response.status_code in (401, 403):
            # An SSE endpoint and a Streamable HTTP endpoint behind the same sign-in refuse
            # an anonymous request identically (Atlassian's `/v1/sse` and `/v1/mcp` send the
            # same 401), so nothing here proves the transport. The address is only grounds
            # for a warning, and the sign-in goes ahead as for any other server.
            challenged = await self._challenged(
                server_url=server_url,
                response=response,
                deadline=deadline,
                credentials=credentials,
            )
            challenged.legacy_transport_suspected = _names_legacy_event_stream(
                server_url
            )
            return challenged

        # A legacy server takes messages at an address it names on its stream, not at this
        # one, so it refuses the POST. The GET is what tells it from a wrong address.
        if response.status_code in (404, 405) and await self._opens_event_stream(
            target, deadline=deadline
        ):
            return _unsupported_transport(response, credentials=credentials)

        # A result-shaped body under an error status is not a handshake. A redirect, a 404
        # and a login page all answer, and none of them is a server to connect.
        result = _initialize_result(response) if response.is_success else None
        if result is None:
            return MCPServerProbeResult(
                reachable=True,
                problem=MCPProbeProblem(
                    cause="not_an_mcp_server",
                    message=(
                        "The address answered, but not with an MCP handshake "
                        f"(HTTP {response.status_code})."
                    ),
                    response=_excerpt(response, credentials=credentials),
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

    async def _opens_event_stream(self, target, *, deadline: float) -> bool:
        """Whether a plain GET opens an event stream, as the legacy HTTP+SSE transport does.

        Only the status and the media type are read. The stream is closed before its first
        event, because what that event says is of no use to a transport Agenta does not
        speak. A failed check is not evidence of anything, so it reads as no stream.
        """
        try:
            async with (
                asyncio.timeout_at(deadline),
                egress_client(
                    timeout=_EVENT_STREAM_TIMEOUT_SECONDS, transport=self._transport
                ) as client,
            ):
                request = client.build_request(
                    "GET",
                    target.url,
                    headers={**target.headers, "accept": "text/event-stream"},
                    extensions=target.extensions,
                )
                response = await client.send(request, stream=True)
                await response.aclose()
        except (TimeoutError, httpx.HTTPError):
            return False
        return (
            response.status_code == 200 and _media_type(response) == "text/event-stream"
        )

    async def _challenged(
        self,
        *,
        server_url: str,
        response: httpx.Response,
        deadline: float,
        credentials: Tuple[bytes, ...],
    ) -> MCPServerProbeResult:
        """A server that refused the anonymous handshake. Ask it how to authorize."""
        challenged = MCPProbeAuth(
            mode=MCPProbeAuthMode.UNKNOWN,
            challenge_status=response.status_code,
            challenge_schemes=_challenge_schemes(response),
        )
        try:
            # What remains of the handshake's deadline. Discovery walks several candidate
            # URLs, each with its own inactivity timeout, so without this the 401 branch
            # could outlast the branch that never reaches it (D46).
            async with asyncio.timeout_at(deadline):
                discovery = await self.oauth_client.discover(
                    server_url=server_url, challenge=response
                )
        except TimeoutError:
            return MCPServerProbeResult(
                reachable=True,
                auth=challenged,
                problem=MCPProbeProblem(
                    cause="auth_undiscoverable",
                    message=(
                        "The server requires authorization but did not finish "
                        "publishing its OAuth configuration in time."
                    ),
                    response=_excerpt(response, credentials=credentials),
                ),
            )
        except MCPOAuthDiscoveryError as e:
            # The server wants something. It did not say what in a form we support, and a
            # 401 alone is not evidence of an API key, so the journey offers its manual
            # fallback with this sentence rather than a credential field by default.
            return MCPServerProbeResult(
                reachable=True,
                auth=challenged,
                problem=MCPProbeProblem(
                    cause="auth_undiscoverable",
                    message=(
                        "The server requires authorization but did not publish an OAuth "
                        f"configuration we could read: {e.detail or 'no metadata found'}."
                    ),
                    response=_excerpt(response, credentials=credentials),
                ),
            )

        try:
            async with asyncio.timeout_at(deadline):
                registration = await self._registration(discovery)
        except TimeoutError:
            # OAuth was found. Only the client-identity strategy is unknown, and saying
            # nothing about it is truer than a guess.
            registration = None

        return MCPServerProbeResult(
            reachable=True,
            auth=MCPProbeAuth(
                mode=MCPProbeAuthMode.OAUTH,
                authorization_server=discovery.authorization_server,
                scopes_offered=discovery.scopes_offered,
                registration=registration,
                redirect_uri=callback_redirect_uri(api_url=self.api_url),
                challenge_status=challenged.challenge_status,
                challenge_schemes=challenged.challenge_schemes,
            ),
        )

    async def _registration(self, discovery: MCPOAuthDiscovery) -> MCPProbeRegistration:
        """Which client-identity strategy this deployment would use on its own.

        Mirrors `MCPOAuthConnectService._resolve_client_info` past the client a person
        enters, so they are told before consent what that method would find at the
        point of no return. `unavailable` is a server that needs a client registered
        with it by hand, and the connect screen asks for one.
        """
        if discovery.client_id_metadata_document_supported and (
            await is_publicly_resolvable_async(self.api_url)
        ):
            return MCPProbeRegistration.METADATA
        if discovery.registration_endpoint:
            return MCPProbeRegistration.DYNAMIC
        return MCPProbeRegistration.UNAVAILABLE

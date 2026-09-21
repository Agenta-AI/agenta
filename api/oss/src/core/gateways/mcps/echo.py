"""Refusing a relayed MCP response that carries the credential the gateway injected.

The LLM plane refuses a response that returns the key it was sent, on the body and on the
header block, because a provider that echoes an `Authorization` hands its caller a
credential that caller was never meant to read. The MCP plane relays the same way and
injects the same kind of value — an endpoint's OAuth grant, its API key, or a brokered
session credential — so it takes the same refusal, built from the same scanner in
`core/gateways/dtos.py` rather than from a second implementation.

One difference decides the shape of this module. The LLM plane writes the credential into
headers it names itself, so `injected_credential_values` keys off a fixed set of names. An
MCP endpoint's credential header name is endpoint configuration
(`MCPEndpointRoute.credential_header`), so the name is not knowable here. What *is*
knowable is that every header in the layer an adapter puts above the caller's was injected
by the gateway, so that layer is the input and the shared helper normalizes each value.

No MCP relay streams. Every adapter reads the upstream response whole — `MCPRelayResult.body`
is `bytes`, not an iterator — before it returns, so nothing is relayed before it has been
scanned and detection alone is sufficient. `CredentialEchoRelay`, which the LLM plane needs
because its SSE path yields bytes as they arrive, therefore has no caller here.
"""

from typing import Dict, Mapping, Optional, Tuple

from oss.src.core.gateways.dtos import (
    CredentialEchoScanner,
    credential_echo_envelope,
    injected_credential_values,
)
from oss.src.core.gateways.mcps.types import MCPUpstreamError


class MCPUpstreamCredentialEchoError(MCPUpstreamError):
    """The upstream returned the credential the gateway sent it.

    An `MCPUpstreamError` so the proxy's existing mapping still catches it, and `envelope`
    carries the shared `{code, message, retryable, next_step, details}` refusal the LLM
    plane raises, with the same `code` so a harness can tell an echo apart from a plain
    upstream failure. Never carries the value itself: this refusal reaches the sandbox and
    the transcript, which is the disclosure it exists to prevent.
    """

    def __init__(self, *, target: str, status_code: Optional[int] = None):
        self.envelope = credential_echo_envelope(target=target)
        super().__init__(
            target=target,
            status_code=status_code,
            detail=self.envelope["message"],
        )


def injected_mcp_credentials(headers: Mapping[str, str]) -> Tuple[bytes, ...]:
    """The values to scan a relayed response for, whatever header name carried them.

    Each header is normalized one at a time through `injected_credential_values` under a
    name that helper recognises, so the scheme-prefix rule (`Bearer sk-x` yields `sk-x`)
    and the minimum length below which a value identifies nothing have one definition
    across both planes.
    """
    values: Dict[bytes, None] = {}
    for value in headers.values():
        for token in injected_credential_values({"authorization": value}):
            values[token] = None
    return tuple(values)


def credential_echo_scanner(headers: Mapping[str, str]) -> CredentialEchoScanner:
    """A scanner over the credentials an adapter is about to inject."""
    return CredentialEchoScanner(injected_mcp_credentials(headers))


def refuse_credential_echo(
    *,
    scanner: CredentialEchoScanner,
    target: str,
    status_code: int,
    headers: Mapping[str, str],
    body: bytes,
) -> None:
    """Raise when the upstream's header block or body holds an injected credential.

    The header block is checked as well as the body: the proxy copies an upstream's own
    headers onto Agenta's response, so a server answering 200 with the grant in, say,
    `X-Debug-Auth` discloses it without a byte of the body containing it.
    """
    if not scanner.active:
        return
    if scanner.detects_headers(headers) or scanner.contains(body):
        raise MCPUpstreamCredentialEchoError(target=target, status_code=status_code)

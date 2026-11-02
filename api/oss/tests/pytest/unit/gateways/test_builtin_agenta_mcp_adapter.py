"""Unit tests for the builtin `agenta` MCP adapter's protocol lifecycle.

Nothing running: the adapter is exercised as a plain Python object with a stub request.

OR56. Three components named three different methods for one step. The runner's Pi extension
opened with `server/discover`, the runner's handshake probe opened with `initialize`, and this
adapter answered neither — it accepted only `tools/list` and `tools/call`, so a client that
opened a connection the way the specification says never reached the tool list at all. The
lifecycle is now one: `initialize`, then `tools/list`, then `tools/call`. `"initialize"` is the
same string the runner pins as `MCP_DISCOVERY_METHOD`
(`services/runner/src/extensions/pi-mcp.ts`, asserted there in
`tests/unit/pi-gateway-mcp.test.ts`).
"""

import json
from types import SimpleNamespace

import pytest

from oss.src.core.gateways.mcps.providers.agenta.adapter import AgentaMCPAdapter

# The one method every MCP client on the runner opens with, and the string the runner's
# `MCP_DISCOVERY_METHOD` holds. Both sides fail if either moves.
DISCOVERY_METHOD = "initialize"


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            gateway_run_id="run-1",
            gateway_tools=[
                {
                    "name": "echo",
                    "call_ref": "tool:echo",
                    "description": "echo",
                    "input_schema": {"type": "object"},
                }
            ],
        )
    )


def _rpc(method: str, *, params=None, request_id=1) -> bytes:
    payload = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        payload["id"] = request_id
    if params is not None:
        payload["params"] = params
    return json.dumps(payload).encode()


@pytest.mark.asyncio
async def test_handshake_is_answered_with_the_method_the_runner_sends():
    adapter = AgentaMCPAdapter(tools_router=None)

    result = await adapter.relay(
        request=_request(),
        body=_rpc(
            DISCOVERY_METHOD,
            params={
                "protocolVersion": "2026-07-28",
                "capabilities": {},
                "clientInfo": {"name": "agenta-pi-extension", "version": "1"},
            },
        ),
    )

    assert result.status_code == 200
    payload = json.loads(result.body)
    assert payload["id"] == 1
    # The client's own version is echoed back, as the mock adapter and the runner's tool server
    # both do; a fixture that imposed its version would reject clients by version.
    assert payload["result"]["protocolVersion"] == "2026-07-28"
    assert payload["result"]["capabilities"] == {"tools": {}}
    assert payload["result"]["serverInfo"]["name"] == "agenta-builtin-mcp"


@pytest.mark.asyncio
async def test_handshake_survives_the_full_lifecycle_to_tools_list():
    """The whole opening exchange a real client performs, in order."""
    adapter = AgentaMCPAdapter(tools_router=None)
    request = _request()

    await adapter.relay(request=request, body=_rpc(DISCOVERY_METHOD, params={}))

    # A JSON-RPC notification carries no id and is owed no answer.
    notified = await adapter.relay(
        request=request,
        body=_rpc("notifications/initialized", request_id=None),
    )
    assert notified.status_code == 202
    assert notified.body == b""

    listed = await adapter.relay(request=request, body=_rpc("tools/list"))
    payload = json.loads(listed.body)
    assert [tool["name"] for tool in payload["result"]["tools"]] == ["echo"]


@pytest.mark.asyncio
async def test_a_method_outside_the_lifecycle_is_still_refused():
    """`server/discover` is the method that caused OR56; accepting it was never the fix."""
    adapter = AgentaMCPAdapter(tools_router=None)

    with pytest.raises(ValueError) as refusal:
        await adapter.relay(request=_request(), body=_rpc("server/discover"))

    assert "initialize, tools/list and tools/call" in str(refusal.value)

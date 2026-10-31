import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.gateways.mcps.providers.plugin.adapter import PluginMCPAdapter
from oss.src.core.gateways.mcps.types import MCPEndpointNotFoundError


@pytest.fixture
def setup():
    revision = NS(
        version="7",
        flags=NS(is_plugin=True),
        data=NS(
            parameters={
                "plugin": {
                    "operations": [{"name": "ping", "input_schema": {"type": "object"}}]
                }
            }
        ),
    )
    service = NS(
        retrieve_workflow_revision=AsyncMock(return_value=(revision, None, None))
    )
    router = NS(
        call_tool=AsyncMock(
            return_value=NS(
                call=NS(data=NS(content="null"), status=NS(code="STATUS_CODE_OK"))
            )
        )
    )
    return (
        PluginMCPAdapter(workflows_service=service, tools_router=router),
        revision,
        service,
        router,
    )


async def relay(adapter, method, **params):
    body = {"jsonrpc": "2.0", "method": method, "params": params}
    if not method.startswith("notifications/"):
        body["id"] = 1
    return await adapter.relay(
        request=NS(), project_id=uuid4(), slug="triage", body=json.dumps(body).encode()
    )


@pytest.mark.asyncio
async def test_list_uses_manifest_and_project_scope(setup):
    adapter, _, service, _ = setup
    result = await relay(adapter, "tools/list")
    assert json.loads(result.body)["result"]["tools"][0]["name"] == "ping"
    args = service.retrieve_workflow_revision.call_args.kwargs
    assert args["workflow_ref"].slug == "triage"
    assert args["include_archived"] is False
    assert args["project_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["tools/list", "tools/call"])
async def test_non_plugin_refused_before_dispatch(setup, method):
    adapter, revision, _, router = setup
    revision.flags.is_plugin = False
    with pytest.raises(MCPEndpointNotFoundError):
        await relay(adapter, method, name="ping")
    router.call_tool.assert_not_awaited()


@pytest.mark.asyncio
async def test_call_pins_checked_revision(setup):
    adapter, _, _, router = setup
    result = await relay(adapter, "tools/call", name="ping", arguments={"x": 1})
    call = router.call_tool.call_args.kwargs["body"]
    assert call.data.function.name == "workflow.variant.triage.7"
    assert call.data.function.arguments == {"operation": "ping", "args": {"x": 1}}
    assert json.loads(result.body)["result"]["isError"] is False


@pytest.mark.asyncio
async def test_child_error_is_mcp_error(setup):
    adapter, _, _, router = setup
    router.call_tool.return_value.call.status.code = "STATUS_CODE_ERROR"
    result = await relay(adapter, "tools/call", name="ping")
    assert json.loads(result.body)["result"]["isError"] is True


@pytest.mark.asyncio
async def test_unknown_operation_does_not_dispatch(setup):
    adapter, _, _, router = setup
    result = await relay(adapter, "tools/call", name="missing")
    assert json.loads(result.body)["error"]["code"] == -32602
    router.call_tool.assert_not_awaited()


@pytest.mark.asyncio
async def test_notification_has_no_response(setup):
    result = await relay(setup[0], "notifications/initialized")
    assert result.status_code == 202
    assert result.body == b""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body, code",
    [(b"{", -32700), (b"\xff", -32700), (b"[]", -32600), (b"null", -32600)],
)
async def test_bad_request_returns_rpc_error_without_dispatch(setup, body, code):
    adapter, _, service, router = setup
    result = await adapter.relay(
        request=NS(), project_id=uuid4(), slug="triage", body=body
    )
    payload = json.loads(result.body)
    assert payload["id"] is None
    assert payload["error"]["code"] == code
    assert result.status_code < 500
    service.retrieve_workflow_revision.assert_not_awaited()
    router.call_tool.assert_not_awaited()

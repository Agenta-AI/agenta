import pytest
from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import AgentaPlatformToolResolver, get_platform_op


def test_current_session_has_no_model_arguments():
    op = get_platform_op("get_current_session")
    schema = op.resolved_input_schema()
    assert schema == {"type": "object", "properties": {}, "additionalProperties": False}
    assert op.read_only is True
    assert op.context_bindings == {"session_id": "$ctx.session.id"}


@pytest.mark.asyncio
@pytest.mark.parametrize("permission", [None, "ask", "deny"])
async def test_current_session_uses_direct_call_and_preserves_permission(
    connection, permission
):
    result = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op="get_current_session", permission=permission)]
    )
    spec = result.tool_specs[0]
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/sessions/tools/current"
    assert spec.call.context == {"session_id": "$ctx.session.id"}
    assert spec.read_only is True
    assert spec.permission == permission

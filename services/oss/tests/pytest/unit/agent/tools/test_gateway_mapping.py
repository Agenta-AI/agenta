from agenta.sdk.agents import GatewayToolConfig

from oss.src.agent.tools import _to_gateway_reference


def test_gateway_reference_uses_canonical_sdk_shape():
    assert _to_gateway_reference(
        GatewayToolConfig(
            integration="github",
            action="GET_USER",
            connection="c1",
        )
    ) == {
        "type": "gateway",
        "provider": "composio",
        "integration": "github",
        "action": "GET_USER",
        "connection": "c1",
    }

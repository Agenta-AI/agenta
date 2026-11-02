"""Guard the declarative acceptance matrix against accidental coverage collapse."""

from oss.tests.pytest.acceptance.gateways.mock_matrix import (
    CredentialOwner,
    GATEWAY_MOCK_CASES,
    GatewayNamespace,
    GatewayPlane,
)


def test_gateway_mock_matrix_has_every_declared_dev_case():
    assert {case.key for case in GATEWAY_MOCK_CASES} == {
        "llm_builtin_mock",
        "llm_standard_mock",
        "llm_custom_mock",
        "mcp_builtin_mock",
        "mcp_standard_mock",
        "mcp_custom_mock",
    }


def test_gateway_mock_matrix_keeps_each_namespace_and_auth_boundary_visible():
    for plane in GatewayPlane:
        cases = [case for case in GATEWAY_MOCK_CASES if case.plane is plane]
        assert {case.namespace for case in cases} == set(GatewayNamespace)

    # Standard and custom cover project-owned/direct secret handling; builtins
    # remain platform-owned. Composio is a real brokered integration, not a mock.
    assert {case.credential_owner for case in GATEWAY_MOCK_CASES} == {
        CredentialOwner.PLATFORM,
        CredentialOwner.PROJECT,
        CredentialOwner.DIRECT,
    }


def test_each_plane_has_its_builtin_mock_case():
    builtin_llm = {
        case.provider
        for case in GATEWAY_MOCK_CASES
        if case.plane is GatewayPlane.LLM and case.namespace is GatewayNamespace.BUILTIN
    }
    builtin_mcp = {
        case.provider
        for case in GATEWAY_MOCK_CASES
        if case.plane is GatewayPlane.MCP and case.namespace is GatewayNamespace.BUILTIN
    }

    # `builtin/agenta` is the platform's real Vertex account, never a mock.
    assert builtin_llm == {"mock"}
    assert builtin_mcp == {"mock"}

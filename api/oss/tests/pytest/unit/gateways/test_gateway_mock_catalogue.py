"""Guard the declarative acceptance matrix against accidental coverage collapse."""

from oss.tests.pytest.acceptance.gateways.mock_matrix import (
    CredentialOwner,
    GATEWAY_MOCK_CASES,
    GatewayNamespace,
    GatewayPlane,
)


def test_gateway_mock_matrix_has_every_declared_dev_case():
    assert {case.key for case in GATEWAY_MOCK_CASES} == {
        "llm_builtin_agenta",
        "llm_builtin_mock",
        "llm_standard_mock",
        "llm_custom_mock",
        "mcp_builtin_agenta",
        "mcp_builtin_composio",
        "mcp_builtin_mock",
        "mcp_standard_mock",
        "mcp_custom_mock",
    }


def test_gateway_mock_matrix_keeps_each_namespace_and_auth_boundary_visible():
    for plane in GatewayPlane:
        cases = [case for case in GATEWAY_MOCK_CASES if case.plane is plane]
        assert {case.namespace for case in cases} == set(GatewayNamespace)

    # Standard and custom test project-owned/direct secret handling respectively;
    # builtin covers platform-owned auth and Composio covers brokered auth.
    assert {case.credential_owner for case in GATEWAY_MOCK_CASES} == set(
        CredentialOwner
    )


def test_provider_variants_are_not_collapsed_into_one_builtin_case():
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

    assert builtin_llm == {"agenta", "mock"}
    assert builtin_mcp == {"agenta", "composio", "mock"}

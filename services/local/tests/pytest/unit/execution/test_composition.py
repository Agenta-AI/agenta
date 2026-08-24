import pytest
from agenta.sdk.agents.adapters.sandbox_agent import SandboxAgentBackend
from agenta.sdk.agents.connections.models import ModelRef, RuntimeAuthContext
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.tools.models import ResolvedToolSet
from agenta_local.core.execution.dtos import ExecutionCredential
from agenta_local.execution.sdk.composition import build_composition


@pytest.fixture
def credential() -> ExecutionCredential:
    return ExecutionCredential(provider="openai", api_key="sk-test-123")


def test_select_backend_yields_local_sandbox_backend(credential):
    composition, _ = build_composition(
        runner_url="http://127.0.0.1:9/", credential=credential
    )
    template = AgentTemplate.from_params({})

    backend = composition.select_backend(template)

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "local"
    assert backend._url == "http://127.0.0.1:9/"


async def test_empty_resolvers_return_empty_results_without_platform_code(credential):
    composition, _ = build_composition(
        runner_url="http://127.0.0.1:9/", credential=credential
    )

    tools = await composition.resolve_tools([])
    mcps = await composition.resolve_mcp_servers([])

    # Platform resolvers would raise without platform env/config; empty results
    # prove these calls never reached them.
    assert isinstance(tools, ResolvedToolSet)
    assert tools.tool_specs == []
    assert mcps == []


async def test_resolve_connection_carries_static_credential(credential):
    _, resolver = build_composition(
        runner_url="http://127.0.0.1:9/", credential=credential
    )

    resolved = await resolver.resolve(
        model=ModelRef(provider="openai", model="gpt-5-mini"),
        context=RuntimeAuthContext(harness="pi_core", backend="local"),
    )

    assert resolved.credential_mode != "runtime_provided"
    values = resolved.plaintext_environment()
    assert values.get("OPENAI_API_KEY") == "sk-test-123"

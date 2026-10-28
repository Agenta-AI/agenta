"""The needs-setup check: one requirement per item, reasons per kind, the caller's fix."""

from types import SimpleNamespace
from typing import Any, List
from uuid import uuid4

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_requirements.service import AgentRequirementsService
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import MCPAuthScheme, MCPEndpointFlags
from oss.src.core.secrets.enums import SecretKind
from oss.src.utils.context import AuthScope


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _secret(slug: str, secret_kind: SecretKind, **data: Any) -> Any:
    return SimpleNamespace(slug=slug, kind=secret_kind, data=SimpleNamespace(**data))


def _text_secret(slug: str) -> Any:
    return _secret(
        slug,
        SecretKind.CUSTOM_SECRET,
        secret=SimpleNamespace(format="text", content="value"),
    )


class _Vault:
    def __init__(self, project=(), organization=(), organization_all=()):
        self.project = list(project)
        self.organization = list(organization)
        self.organization_all = list(organization_all)
        self.calls: List[str] = []

    async def list_project_and_organization_secrets(
        self, *, organization_id, project_id
    ):
        self.calls.append("entry")
        return self.project, self.organization

    async def list_organization_secrets(self, *, organization_id):
        self.calls.append("organization")
        return self.organization_all


class _Llm:
    def __init__(self, outcome=None, resolution=None):
        self.outcome = outcome
        self.resolution = resolution
        self.calls: List[dict] = []

    async def agent_connection_requirement(self, **kwargs):
        self.calls.append(kwargs)
        return self.outcome, self.resolution


class _Mcp:
    def __init__(self, endpoints=()):
        self.endpoints = list(endpoints)
        self.calls = 0

    async def query_endpoints(self, *, project_id):
        self.calls += 1
        return self.endpoints


class _Connections:
    def __init__(self, connections=()):
        self.connections = list(connections)
        self.calls = 0

    async def query_connections(self, *, project_id, is_active=None):
        self.calls += 1
        return self.connections


def _mcp_endpoint(slug, *, auth="none", active=True, valid=True, secret=False):
    return SimpleNamespace(
        slug=slug,
        namespace=GatewayEndpointNamespace.CUSTOM,
        auth_mode=MCPAuthScheme(auth),
        secret_id=uuid4() if secret else None,
        flags=MCPEndpointFlags(is_active=active, is_valid=valid),
    )


def _connection(integration, slug, *, active=True, valid=True):
    return SimpleNamespace(
        provider_key="composio",
        integration_key=integration,
        slug=slug,
        is_active=active,
        is_valid=valid,
        has_auth=True,
        provider_connection_id="ca_1",
    )


def _service(vault=None, llm=None, mcp=None, connections=None):
    return AgentRequirementsService(
        vault_service=vault or _Vault(),
        llm_gateway_service=llm or _Llm(),
        mcp_gateway_service=mcp or _Mcp(),
        connections_service=connections or _Connections(),
    )


async def _yes() -> bool:
    return True


async def _no() -> bool:
    return False


class _Allowed:
    def __init__(self, allowed: bool = True):
        self.allowed = allowed
        self.asked: List[Permission] = []

    async def __call__(self, permission: Permission) -> bool:
        self.asked.append(permission)
        return self.allowed


def _agent(**agent: Any) -> dict:
    return {"agent": {"llm": {"model": "gpt-5.5", "provider": "openai"}, **agent}}


@pytest.mark.asyncio
async def test_a_ready_agent_returns_an_empty_list_and_reads_no_permission():
    allowed = _Allowed()
    edits: List[bool] = []

    async def _can_edit() -> bool:
        edits.append(True)
        return True

    result = await _service().check(
        scope=_scope(),
        parameters=_agent(),
        can_edit_agent=_can_edit,
        allowed=allowed,
        manages_organization=_no,
    )

    assert result.status.value == "ready"
    assert result.count == 0 and result.requirements == []
    assert allowed.asked == [] and edits == []


@pytest.mark.asyncio
async def test_the_agent_reads_only_the_stores_its_items_live_in():
    mcp, connections = _Mcp(), _Connections()
    await _service(mcp=mcp, connections=connections).check(
        scope=_scope(),
        parameters=_agent(),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    assert mcp.calls == 0 and connections.calls == 0


@pytest.mark.asyncio
async def test_two_tools_naming_one_deleted_connection_give_one_requirement():
    tool = {
        "type": "gateway",
        "provider": "composio",
        "integration": "github",
        "action": "GITHUB_GET_REPO",
        "connection": "github-x1",
    }
    other = dict(tool, action="GITHUB_LIST_ISSUES")
    result = await _service(
        connections=_Connections([_connection("github", "github-release")])
    ).check(
        scope=_scope(),
        parameters=_agent(tools=[tool, other]),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.key == "app_connection:github/github-x1"
    assert requirement.reason.value == "not_found"
    assert requirement.paths == [
        "agent.tools[0].connection",
        "agent.tools[1].connection",
    ]
    assert requirement.blocks_run is False
    assert requirement.fix.candidates == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "connection, reason",
    [
        (_connection("github", "github-x1", active=False), "turned_off"),
        (_connection("github", "github-x1", valid=False), "needs_sign_in"),
    ],
)
async def test_app_connection_reasons(connection, reason):
    tool = {
        "type": "gateway_connection",
        "connection": {
            "provider": "composio",
            "integration": "github",
            "slug": "github-x1",
        },
        "policy": {"permissions": {"default": "allow"}},
    }
    result = await _service(connections=_Connections([connection])).check(
        scope=_scope(),
        parameters=_agent(tools=[tool]),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.reason.value == reason


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoints, kind, reason",
    [
        ([], "mcp_server", "not_found"),
        ([_mcp_endpoint("gh", active=False)], "mcp_server", "turned_off"),
        ([_mcp_endpoint("gh", auth="oauth")], "mcp_sign_in", "needs_sign_in"),
        (
            [_mcp_endpoint("gh", auth="oauth", secret=True, valid=False)],
            "mcp_sign_in",
            "needs_sign_in",
        ),
    ],
)
async def test_mcp_server_reasons(endpoints, kind, reason):
    mcps = [
        {
            "name": "gh",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "gh"},
        }
    ]
    result = await _service(mcp=_Mcp(endpoints)).check(
        scope=_scope(),
        parameters=_agent(mcps=mcps),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.kind.value == kind
    assert requirement.reason.value == reason
    assert requirement.blocks_run is False


@pytest.mark.asyncio
async def test_a_signed_in_mcp_server_is_ready():
    mcps = [
        {
            "name": "gh",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "gh"},
        }
    ]
    result = await _service(
        mcp=_Mcp([_mcp_endpoint("gh", auth="oauth", secret=True)])
    ).check(
        scope=_scope(),
        parameters=_agent(mcps=mcps),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    assert result.requirements == []


@pytest.mark.asyncio
async def test_a_missing_custom_secret_is_one_requirement_for_every_path():
    parameters = _agent(
        sandbox={
            "credentials": [
                {
                    "secret": {"slug": "gone"},
                    "binding": {"type": "env", "name": "TOKEN"},
                }
            ]
        },
        tools=[
            {
                "type": "code",
                "name": "x",
                "script": "print(1)",
                "runtime": "python",
                "secrets": ["gone", "kept"],
            }
        ],
    )
    result = await _service(vault=_Vault(project=[_text_secret("kept")])).check(
        scope=_scope(),
        parameters=parameters,
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.key == "secret:gone"
    assert requirement.paths == [
        "agent.sandbox.credentials[0].secret",
        "agent.tools[0].secrets[0]",
    ]
    assert requirement.fix.candidates == 1


@pytest.mark.asyncio
async def test_a_model_key_requirement_blocks_the_run_and_has_no_remove():
    result = await _service(llm=_Llm(("model_key", "not_found"))).check(
        scope=_scope(),
        parameters={
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "agenta", "slug": "gone-key"},
                }
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.key == "model_key:project/gone-key"
    assert requirement.blocks_run is True
    assert result.status.value == "needs_setup"


@pytest.mark.asyncio
async def test_an_organization_key_this_project_may_not_use_is_not_shared():
    vault = _Vault(
        organization_all=[_secret("org-key", SecretKind.PROVIDER_KEY, kind="openai")]
    )
    result = await _service(vault=vault, llm=_Llm(("model_key", "not_found"))).check(
        scope=_scope(),
        parameters={
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {
                        "mode": "agenta",
                        "slug": "org-key",
                        "scope": "organization",
                    },
                }
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_yes,
    )
    [requirement] = result.requirements
    assert requirement.reason.value == "not_shared"
    assert requirement.fix.ask.role == "organization_admin"


@pytest.mark.asyncio
async def test_a_member_who_does_not_manage_the_organization_reads_not_found():
    vault = _Vault(
        organization_all=[_secret("org-key", SecretKind.PROVIDER_KEY, kind="openai")]
    )
    result = await _service(vault=vault, llm=_Llm(("model_key", "not_found"))).check(
        scope=_scope(),
        parameters={
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {
                        "mode": "agenta",
                        "slug": "org-key",
                        "scope": "organization",
                    },
                }
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    # No probing for organization connection names through a draft.
    assert requirement.reason.value == "not_found"
    assert "organization" not in vault.calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows, reason",
    [
        ([], "not_found"),
        (
            [
                _secret(
                    "my-chatgpt",
                    SecretKind.SUBSCRIPTION_PROVIDER,
                    provider="chatgpt",
                    login_state="needs_login",
                    login=None,
                )
            ],
            "needs_sign_in",
        ),
    ],
)
async def test_subscription_reasons(rows, reason):
    result = await _service(vault=_Vault(project=rows)).check(
        scope=_scope(),
        parameters={
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "self_managed", "slug": "my-chatgpt"},
                }
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.kind.value == "subscription"
    assert requirement.reason.value == reason
    assert requirement.blocks_run is True


@pytest.mark.asyncio
async def test_an_unnamed_self_managed_login_is_never_a_requirement():
    llm = _Llm(("model_key", "not_found"))
    result = await _service(llm=llm).check(
        scope=_scope(),
        parameters={
            "agent": {
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "self_managed"},
                }
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    assert result.requirements == [] and llm.calls == []


@pytest.mark.asyncio
async def test_a_harness_that_cannot_reach_the_provider_makes_the_model_not_available():
    result = await _service().check(
        scope=_scope(),
        parameters={
            "agent": {
                "harness": {"kind": "claude"},
                "llm": {"model": "gpt-5.5", "provider": "openai"},
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.kind.value == "model"
    assert requirement.reason.value == "not_available"


@pytest.mark.asyncio
async def test_a_viewer_sees_the_requirement_and_who_can_fix_it():
    mcps = [
        {
            "name": "gh",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "gh"},
        }
    ]
    result = await _service().check(
        scope=_scope(),
        parameters=_agent(mcps=mcps),
        can_edit_agent=_no,
        allowed=_Allowed(allowed=False),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.kind.value == "mcp_server"
    assert requirement.fix.can_edit_agent is False
    assert requirement.fix.can_connect is False
    assert requirement.fix.ask.role == "agent_editor"


@pytest.mark.asyncio
async def test_unset_template_slots_produce_no_requirement():
    """A template slot the person skipped is not written into the agent."""
    result = await _service().check(
        scope=_scope(),
        parameters=_agent(tools=[], mcps=[]),
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    assert result.requirements == []


@pytest.mark.asyncio
async def test_model_requirements_read_only_the_model():
    mcp, connections = _Mcp(), _Connections()
    service = _service(
        llm=_Llm(("model_key", "not_chosen")), mcp=mcp, connections=connections
    )
    requirements = await service.model_requirements(
        scope=_scope(),
        parameters=_agent(
            mcps=[
                {
                    "name": "gh",
                    "connection": {
                        "type": "gateway",
                        "namespace": "custom",
                        "slug": "gh",
                    },
                }
            ]
        ),
    )
    assert [requirement.kind.value for requirement in requirements] == ["model_key"]
    assert mcp.calls == 0 and connections.calls == 0


@pytest.mark.asyncio
async def test_a_named_connection_the_harness_cannot_consume_makes_the_model_not_available():
    """The run's post-resolve pair check: Claude cannot drive an OpenAI connection."""
    resolution = SimpleNamespace(provider_key="openai", deployment_kind="direct")
    result = await _service(llm=_Llm(None, resolution)).check(
        scope=_scope(),
        parameters={
            "agent": {
                "harness": {"kind": "claude"},
                "llm": {
                    "model": "gpt-5.5",
                    "connection": {"mode": "agenta", "slug": "my-openai"},
                },
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert requirement.kind.value == "model"
    assert requirement.reason.value == "not_available"


@pytest.mark.asyncio
async def test_a_subscription_the_harness_cannot_drive_makes_the_model_not_available():
    """A ChatGPT login runs only on Pi: on Codex the run refuses it."""
    row = _secret(
        "my-chatgpt",
        SecretKind.SUBSCRIPTION_PROVIDER,
        provider="chatgpt",
        login_state="ready",
        login={"token": "x"},
    )
    result = await _service(vault=_Vault(project=[row])).check(
        scope=_scope(),
        parameters={
            "agent": {
                "harness": {"kind": "codex"},
                "llm": {
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "self_managed", "slug": "my-chatgpt"},
                },
            }
        },
        can_edit_agent=_yes,
        allowed=_Allowed(),
        manages_organization=_no,
    )
    [requirement] = result.requirements
    assert (requirement.kind.value, requirement.reason.value) == (
        "model",
        "not_available",
    )

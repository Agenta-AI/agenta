"""Needs setup at run start: only model items block a run; other missing items are left out."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, List

import pytest

from agenta.sdk.agents.connections import (
    GatewayConnectionRefusedError,
    SubscriptionConnectionMissingError,
    SubscriptionLoginRequiredError,
    UnsupportedDeploymentError,
    UnsupportedProviderError,
)
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.requirements import (
    AGENT_NEEDS_SETUP,
    AgentNeedsSetupError,
    LlmReference,
    model_requirement_from_error,
    read_agent_references,
    requirement,
)
from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware

from .test_agent_composition_seam import (
    _FakeBackend,
    _no_connection,
    _params,
    _request,
)


def _llm(**connection: Any) -> LlmReference:
    return LlmReference(
        model="gpt-5.5",
        provider="openai",
        mode=connection.get("mode", "agenta"),
        slug=connection.get("slug"),
        namespace=None,
        scope=connection.get("scope"),
        harness="pi_core",
        prefix="agent.",
    )


def test_two_tools_naming_one_connection_give_one_item_with_both_paths():
    references = read_agent_references(
        {
            "agent": {
                "tools": [
                    {
                        "type": "gateway",
                        "provider": "composio",
                        "integration": "github",
                        "action": "GITHUB_GET_REPO",
                        "connection": "github-x1",
                    },
                    {
                        "type": "gateway_connection",
                        "connection": {
                            "provider": "composio",
                            "integration": "github",
                            "slug": "github-x1",
                        },
                        "policy": {"permissions": {"default": "allow"}},
                    },
                ]
            }
        }
    )
    [item] = references.app_connections
    assert item.key == "app_connection:github/github-x1"
    assert item.paths == ["agent.tools[0].connection", "agent.tools[1].connection"]


def test_an_unnamed_self_managed_login_is_not_an_agenta_item():
    assert _llm(mode="self_managed").connection_item() is None


@pytest.mark.parametrize(
    "error, kind, reason, code",
    [
        (
            GatewayConnectionRefusedError("gone", failure_code="endpoint_not_found"),
            "model_key",
            "not_found",
            "endpoint_not_found",
        ),
        (
            GatewayConnectionRefusedError("off", failure_code="endpoint_inactive"),
            "model_key",
            "turned_off",
            "endpoint_inactive",
        ),
        (
            GatewayConnectionRefusedError("no", failure_code="model_not_available"),
            "model",
            "not_available",
            "model_not_available",
        ),
    ],
)
def test_resolve_failures_map_to_model_requirements(error, kind, reason, code):
    needs = model_requirement_from_error(error, _llm(slug="my-key"))
    assert needs["kind"] == kind
    assert needs["reason"] == reason
    assert needs["blocks_run"] is True
    assert needs["detail"] == {"code": code}


def test_a_subscription_login_that_needs_sign_in_maps_to_needs_sign_in():
    needs = model_requirement_from_error(
        SubscriptionLoginRequiredError(slug="my-chatgpt", provider="chatgpt"),
        _llm(mode="self_managed", slug="my-chatgpt"),
    )
    assert needs["kind"] == "subscription"
    assert needs["reason"] == "needs_sign_in"
    assert needs["detail"] == {"code": "subscription_login_required"}


def test_an_outage_is_not_a_missing_item():
    assert (
        model_requirement_from_error(
            GatewayConnectionRefusedError("down", failure_code="gateway_unavailable"),
            _llm(slug="my-key"),
        )
        is None
    )


async def test_a_deleted_model_key_fails_before_the_sandbox_starts():
    backend = _FakeBackend()

    async def _deleted(*, model, context):
        raise GatewayConnectionRefusedError(
            "LLM endpoint not found", failure_code="endpoint_not_found"
        )

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: backend, resolve_connection=_deleted
        )
    )

    with pytest.raises(AgentNeedsSetupError) as raised:
        await handler(
            request=_request(),
            messages=[{"role": "user", "content": "hi"}],
            parameters=_params(
                model={
                    "model": "gpt-5.5",
                    "provider": "openai",
                    "connection": {"mode": "agenta", "slug": "gone-key"},
                }
            ),
        )

    assert raised.value.failure_code == AGENT_NEEDS_SETUP
    assert raised.value.code == 422
    [needs] = raised.value.requirements
    assert needs["key"] == "model_key:project/gone-key"
    assert needs["paths"] == ["agent.llm.connection"]
    assert needs["detail"] == {"code": "endpoint_not_found"}
    assert backend.created_configs == []


async def test_an_unready_mcp_server_is_left_out_of_the_run():
    backend = _FakeBackend()
    seen: List[Any] = []

    async def _mcp(servers, **kwargs):
        return [
            ResolvedMCPServer(name=server.name, url="https://gw/x", headers={})
            for server in servers
        ]

    async def _unready(servers):
        return {"gone-mcp"}

    async def _credentials(credentials, *, resolved_connection, mcp_servers):
        seen.extend(server.name for server in mcp_servers)
        return []

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: backend,
            resolve_connection=_no_connection,
            resolve_mcp_servers=_mcp,
            unready_mcp_servers=_unready,
            resolve_sandbox_credentials=_credentials,
        )
    )
    parameters = _params(model="openai/gpt-5.5")
    parameters["agent"]["mcps"] = [
        {
            "name": "kept",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "ok"},
        },
        {
            "name": "gone",
            "connection": {
                "type": "gateway",
                "namespace": "custom",
                "slug": "gone-mcp",
            },
        },
    ]

    await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=parameters,
    )

    assert seen == ["kept"]
    assert len(backend.created_configs) == 1


async def test_the_error_body_carries_the_requirements():
    error = AgentNeedsSetupError([{"key": "model:openai/x", "kind": "model"}])
    response = await NormalizerMiddleware()._normalize_exception(error)
    assert response.status.code == 422
    assert response.status.failure_code == AGENT_NEEDS_SETUP
    assert response.status.message == "The model needs setup before this agent can run."
    assert response.status.details == {
        "requirements": [{"key": "model:openai/x", "kind": "model"}]
    }


@pytest.mark.parametrize(
    "error, code",
    [
        (
            UnsupportedProviderError(provider="openai", harness="claude"),
            "unsupported_provider",
        ),
        (
            UnsupportedDeploymentError(deployment="vertex_ai", harness="pi_core"),
            "unsupported_deployment",
        ),
    ],
)
def test_a_pair_the_harness_cannot_drive_makes_the_model_not_available(error, code):
    needs = model_requirement_from_error(error, _llm(slug="my-key"))
    assert (needs["kind"], needs["reason"]) == ("model", "not_available")
    assert needs["detail"] == {"code": code}


async def test_a_service_tool_resolver_is_told_to_leave_missing_secrets_out():
    """The deployed service overrides `resolve_tools`; the handler still asks it to run a
    code tool without a missing custom secret instead of failing the run."""
    from agenta.sdk.agents.tools import MissingSecretPolicy, ResolvedToolSet

    seen: List[Any] = []

    async def _tools(tools, **kwargs):
        seen.append(kwargs.get("missing_secret_policy"))
        return ResolvedToolSet(tool_specs=[])

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: _FakeBackend(),
            resolve_connection=_no_connection,
            resolve_tools=_tools,
        )
    )
    await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=_params(model="openai/gpt-5.5"),
    )
    assert seen == [MissingSecretPolicy.OMIT]


# --- round trips: the run start adds a request only for a named MCP server ---------- #


async def test_the_mcp_readiness_check_sends_nothing_without_a_named_mcp_server(
    monkeypatch,
):
    from agenta.sdk.agents.mcp import parse_mcp_server_configs
    from agenta.sdk.agents.platform import requirements as platform_requirements

    sent: List[Any] = []

    class _Client:
        def __init__(self, *args, **kwargs):
            sent.append(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, **kwargs):
            sent.append(url)
            return SimpleNamespace(status_code=200, json=lambda: {"requirements": []})

    monkeypatch.setattr(platform_requirements.httpx, "AsyncClient", _Client)
    connection = SimpleNamespace(
        base_url=lambda: "https://api.x/api", headers=lambda: {}, timeout=5
    )

    assert (
        await platform_requirements.unready_mcp_servers([], connection=connection)
        == set()
    )
    direct = parse_mcp_server_configs(
        [{"name": "d", "connection": {"type": "http", "url": "https://mcp.x"}}]
    )
    assert (
        await platform_requirements.unready_mcp_servers(direct, connection=connection)
        == set()
    )
    assert sent == []

    named = parse_mcp_server_configs(
        [
            {
                "name": "gh",
                "connection": {"type": "gateway", "namespace": "custom", "slug": "gh"},
            }
        ]
    )
    await platform_requirements.unready_mcp_servers(named, connection=connection)
    assert [item for item in sent if isinstance(item, str)] == [
        "https://api.x/api/workflows/revisions/requirements/query"
    ]


# --- "user" items: each person brings the account; `read_user_items` reads them ------ #


def _user_agent() -> dict:
    return {
        "agent": {
            "llm": {
                "model": "claude-sonnet-4-5",
                "provider": "anthropic",
                "connection": {"mode": "self_managed", "account_source": "user"},
            },
            "tools": [
                {
                    "type": "gateway",
                    "action": "GMAIL_SEND_EMAIL",
                    "connection": {
                        "provider": "composio",
                        "integration": "gmail",
                        "account_source": "user",
                    },
                }
            ],
            "mcps": [
                {
                    "name": "linear",
                    "connection": {
                        "type": "gateway",
                        "namespace": "custom",
                        "slug": "linear",
                        "account_source": "user",
                    },
                }
            ],
            "sandbox": {
                "credentials": [
                    {
                        "secret": {"account_source": "user"},
                        "binding": {"type": "env", "name": "GITHUB_TOKEN"},
                    }
                ]
            },
        }
    }


def test_the_agent_reader_skips_every_user_item():
    references = read_agent_references(_user_agent())
    assert references.mcp_servers == []
    assert references.secrets == []
    assert references.app_connections == []
    assert references.llm is not None
    assert references.llm.account_source == "user"
    assert references.llm.connection_item() is None


def test_a_requirement_says_whose_account_it_needs():
    item = read_agent_references(
        {"agent": {"llm": {"model": "gpt-5.5", "provider": "openai"}}}
    ).llm.connection_item()
    assert requirement(item, reason="not_found")["account_source"] == "agent"


def _user_login() -> LlmReference:
    return LlmReference(
        model="claude-sonnet-4-5",
        provider="anthropic",
        mode="self_managed",
        slug=None,
        namespace=None,
        scope=None,
        harness="claude",
        prefix="agent.",
        account_source="user",
    )


def test_no_login_for_the_run_person_is_a_missing_model():
    needs = model_requirement_from_error(
        SubscriptionConnectionMissingError(slug="claude"), _user_login()
    )
    assert needs == {
        "key": "subscription:user/claude",
        "kind": "subscription",
        "label": "claude",
        "reference": {"login": "claude", "account_source": "user"},
        "paths": ["agent.llm.connection"],
        "reason": "needs_personal_account",
        "blocks_run": True,
        "account_source": "user",
        "detail": {"code": "subscription_connection_missing"},
    }


def test_an_outage_on_a_user_login_is_not_a_missing_item():
    assert (
        model_requirement_from_error(RuntimeError("vault down"), _user_login()) is None
    )


async def test_the_mcp_readiness_check_sends_nothing_for_a_user_server(monkeypatch):
    """A `"user"` server is the gateway's to leave out, so the run start adds no
    request for it."""
    from agenta.sdk.agents.mcp import parse_mcp_server_configs
    from agenta.sdk.agents.platform import requirements as platform_requirements

    sent: List[Any] = []

    class _Client:
        def __init__(self, *args, **kwargs):
            sent.append(kwargs)

    monkeypatch.setattr(platform_requirements.httpx, "AsyncClient", _Client)
    servers = parse_mcp_server_configs(_user_agent()["agent"]["mcps"])
    connection = SimpleNamespace(
        base_url=lambda: "https://api.x/api", headers=lambda: {}, timeout=5
    )
    assert (
        await platform_requirements.unready_mcp_servers(servers, connection=connection)
        == set()
    )
    assert sent == []


async def test_a_project_server_that_needs_setup_keeps_the_same_server_for_the_person():
    """The project's sign-in to `linear` is missing, so its entry is left out. The
    person's own entry for `linear` is the gateway's to decide, so it stays."""
    backend = _FakeBackend()
    seen: List[Any] = []

    async def _mcp(servers, **kwargs):
        return [
            ResolvedMCPServer(name=server.name, url="https://gw/x", headers={})
            for server in servers
        ]

    async def _unready(servers):
        return {"linear"}

    async def _credentials(credentials, *, resolved_connection, mcp_servers):
        seen.extend(server.name for server in mcp_servers)
        return []

    handler = make_agent_handler(
        AgentComposition(
            select_backend=lambda template: backend,
            resolve_connection=_no_connection,
            resolve_mcp_servers=_mcp,
            unready_mcp_servers=_unready,
            resolve_sandbox_credentials=_credentials,
        )
    )
    parameters = _params(model="openai/gpt-5.5")
    parameters["agent"]["mcps"] = [
        {
            "name": "team-linear",
            "connection": {"type": "gateway", "namespace": "custom", "slug": "linear"},
        },
        {
            "name": "my-linear",
            "connection": {
                "type": "gateway",
                "namespace": "custom",
                "slug": "linear",
                "account_source": "user",
            },
        },
    ]

    await handler(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=parameters,
    )

    assert seen == ["my-linear"]


def test_an_organization_secret_is_its_own_item():
    references = read_agent_references(
        {
            "agent": {
                "sandbox": {
                    "credentials": [
                        {
                            "secret": {"slug": "gh", "namespace": "organization"},
                            "binding": {"type": "env", "name": "ORG_GH"},
                        },
                        {
                            "secret": {"slug": "gh"},
                            "binding": {"type": "env", "name": "GH"},
                        },
                    ]
                }
            }
        }
    )
    assert [(item.key, item.reference) for item in references.secrets] == [
        ("secret:organization/gh", {"slug": "gh", "namespace": "organization"}),
        ("secret:gh", {"slug": "gh"}),
    ]

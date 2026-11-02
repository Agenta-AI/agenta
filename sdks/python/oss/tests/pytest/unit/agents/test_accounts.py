"""The "user" items of an agent: the reader, the item models, and how a run reads them."""

from types import SimpleNamespace
from typing import Any, Dict
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.accounts import (
    read_user_items,
    user_item_from_key,
    user_item_key,
)
from agenta.sdk.agents.connections import ModelRef
from agenta.sdk.agents.connections.errors import SubscriptionConnectionMissingError
from agenta.sdk.agents.connections.models import Connection
from agenta.sdk.agents.dtos import SandboxCredentialConfig, SandboxSecretReference
from agenta.sdk.agents.mcp import MCPGatewayConnection
from agenta.sdk.agents.platform import connections as platform_connections
from agenta.sdk.agents import sandbox_credentials
from agenta.sdk.agents.sandbox_credentials import resolve_sandbox_credentials
from agenta.sdk.agents.tools.models import GatewayConnectionRef
from agenta.sdk.middlewares.routing import auth as auth_module
from agenta.sdk.utils.cache import TTLLRUCache

AGENT_ID = "0193d1a0-0000-7000-8000-0000000000aa"
GMAIL = {
    "type": "gateway_connection",
    "connection": {
        "provider": "composio",
        "integration": "gmail",
        "account_source": "user",
    },
}


def _agent(**fields) -> Dict[str, Any]:
    return {"agent": fields}


def test_the_reader_names_each_user_item_once_with_its_paths():
    parameters = _agent(
        llm={
            "model": "sonnet",
            "provider": "anthropic",
            "connection": {"mode": "self_managed", "account_source": "user"},
        },
        tools=[
            GMAIL,
            GMAIL,
            {
                "type": "gateway_connection",
                "connection": {
                    "provider": "composio",
                    "integration": "slack",
                    "slug": "team",
                },
            },
        ],
        mcps=[
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
        sandbox={
            "credentials": [
                {
                    "secret": {"account_source": "user"},
                    "binding": {"type": "env", "name": "GITHUB_TOKEN"},
                },
                {
                    "secret": {"slug": "jira"},
                    "binding": {"type": "env", "name": "JIRA"},
                },
            ]
        },
    )
    items = read_user_items(parameters)
    assert [(i.item_key, i.paths) for i in items] == [
        ("subscription:user/claude", ["agent.llm.connection"]),
        (
            "app_connection:user/gmail",
            ["agent.tools[0].connection", "agent.tools[1].connection"],
        ),
        ("mcp_server:user/linear", ["agent.mcps[0].connection"]),
        ("secret:user/GITHUB_TOKEN", ["agent.sandbox.credentials[0].secret"]),
    ]


@pytest.mark.parametrize(
    "parameters", [None, {}, {"agent": "x"}, {"agent": {"tools": "x"}}]
)
def test_the_reader_never_raises(parameters):
    assert read_user_items(parameters) == []


def test_an_item_key_round_trips():
    key = user_item_key(kind="secret", match_text="GITHUB_TOKEN")
    assert key == "secret:user/GITHUB_TOKEN"
    item = user_item_from_key(key)
    assert (item.kind, item.match_text) == ("secret", "GITHUB_TOKEN")
    for bad in ("secret:GITHUB", "tool:user/x", "secret:user/", "secret:user/a b "):
        assert user_item_from_key(bad) is None


def test_the_item_models_keep_their_rules():
    Connection(mode="self_managed", account_source="user")
    with pytest.raises(ValidationError):
        Connection(mode="agenta", account_source="user")
    with pytest.raises(ValidationError):
        Connection(mode="self_managed", slug="claude", account_source="user")

    GatewayConnectionRef(integration="gmail", account_source="user")
    with pytest.raises(ValidationError):
        GatewayConnectionRef(integration="gmail", slug="mine", account_source="user")
    with pytest.raises(ValidationError):
        GatewayConnectionRef(integration="gmail")
    # An unset account source stays out of the dump, so saved shapes do not change.
    assert (
        "account_source"
        not in GatewayConnectionRef(integration="gmail", slug="mine").model_dump()
    )

    MCPGatewayConnection(namespace="custom", slug="linear", account_source="user")
    with pytest.raises(ValidationError):
        MCPGatewayConnection(namespace="standard", provider="x", account_source="user")

    SandboxSecretReference(account_source="user")
    SandboxSecretReference(slug="jira", namespace="organization")
    with pytest.raises(ValidationError):
        SandboxSecretReference(slug="jira", account_source="user")
    with pytest.raises(ValidationError):
        SandboxSecretReference()
    assert SandboxSecretReference(slug="jira").model_dump() == {"slug": "jira"}


def _credential(secret: Dict[str, Any], name: str) -> SandboxCredentialConfig:
    return SandboxCredentialConfig.model_validate(
        {"secret": secret, "binding": {"type": "env", "name": name}}
    )


@pytest.fixture
def readers(monkeypatch):
    organization = AsyncMock(return_value={"shared": "s"})
    user = AsyncMock(return_value={"secret:user/GITHUB_TOKEN": "g"})

    async def named(slugs, *, scope=None, **_):
        assert scope == "organization"
        return await organization(slugs)

    monkeypatch.setattr(sandbox_credentials, "resolve_named_secrets", named)
    monkeypatch.setattr(sandbox_credentials, "resolve_user_secrets", user)
    return SimpleNamespace(organization=organization, user=user)


async def test_sandbox_credentials_read_each_kind_once_and_leave_a_missing_user_secret_out(
    readers,
):
    project = AsyncMock(return_value={"jira": "j"})
    resolved = await resolve_sandbox_credentials(
        [
            _credential({"slug": "jira"}, "JIRA"),
            _credential({"slug": "shared", "namespace": "organization"}, "SHARED"),
            _credential({"account_source": "user"}, "GITHUB_TOKEN"),
            _credential({"account_source": "user"}, "NOT_SET_UP"),
        ],
        resolver=project,
    )
    assert {c.binding.name: c.value for c in resolved} == {
        "JIRA": "j",
        "SHARED": "s",
        "GITHUB_TOKEN": "g",
    }
    project.assert_awaited_once_with(["jira"])
    readers.organization.assert_awaited_once_with(["shared"])
    readers.user.assert_awaited_once_with(
        ["secret:user/GITHUB_TOKEN", "secret:user/NOT_SET_UP"]
    )


async def test_an_agent_without_user_secrets_sends_no_user_key(readers):
    await resolve_sandbox_credentials(
        [_credential({"slug": "jira"}, "JIRA")],
        resolver=AsyncMock(return_value={"jira": "j"}),
    )
    # The reader gets an empty list, for which it makes no call (see its own test).
    readers.user.assert_awaited_once_with([])


def test_a_user_subscription_login_is_a_missing_model():
    model = ModelRef.model_validate(
        {
            "model": "sonnet",
            "provider": "anthropic",
            "connection": {"mode": "self_managed", "account_source": "user"},
        }
    )
    with pytest.raises(SubscriptionConnectionMissingError):
        platform_connections._resolve_from_secrets(secrets=[], model=model)


class _BodyRequest:
    def __init__(self, body: Any) -> None:
        self.method = "POST"
        self.url = SimpleNamespace(path="/services/agent/v0/invoke")
        self._body = body
        self.headers = {
            "authorization": "ApiKey caller-key",
            "content-type": "application/json",
        }
        self.cookies: Dict[str, str] = {}
        self.state = SimpleNamespace(otel={"baggage": {"project_id": "project-1"}})
        self.query_params: Dict[str, str] = {}

    async def json(self) -> Any:
        return self._body


class _Client:
    calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, *args, **kwargs):
        type(self).calls.append(kwargs.get("params"))
        return SimpleNamespace(
            status_code=200,
            headers={},
            json=lambda: {"effect": "allow", "credentials": "Secret t"},
        )


@pytest.fixture
def exchange(monkeypatch):
    monkeypatch.setattr(auth_module, "_AUTH_ENABLED", True)
    monkeypatch.setattr(auth_module, "_CACHE_ENABLED", True)
    monkeypatch.setattr(auth_module, "_cache", TTLLRUCache())
    _Client.calls = []
    monkeypatch.setattr(auth_module.httpx, "AsyncClient", _Client)
    return _Client


async def test_the_exchange_names_a_turns_user_items_and_skips_the_cache(exchange):
    body = {
        "references": {"application": {"id": AGENT_ID}},
        "data": {"parameters": _agent(tools=[GMAIL])},
    }
    for _ in range(2):
        await auth_module.get_credentials(_BodyRequest(body), "http://agenta.test")
    assert len(exchange.calls) == 2
    assert exchange.calls[0]["workflow_id"] == AGENT_ID
    assert exchange.calls[0]["item_keys"] == ["app_connection:user/gmail"]


async def test_a_turn_without_user_items_sends_nothing_new_and_is_cached(exchange):
    body = {
        "references": {"application": {"id": AGENT_ID}},
        "data": {"parameters": _agent(tools=[])},
    }
    for _ in range(2):
        await auth_module.get_credentials(_BodyRequest(body), "http://agenta.test")
    assert len(exchange.calls) == 1
    assert "item_keys" not in exchange.calls[0]
    assert "workflow_id" not in exchange.calls[0]


async def test_an_unsaved_agent_still_names_its_user_items(exchange):
    body = {"data": {"parameters": _agent(tools=[GMAIL])}}
    await auth_module.get_credentials(_BodyRequest(body), "http://agenta.test")
    assert exchange.calls[0]["item_keys"] == ["app_connection:user/gmail"]
    assert "workflow_id" not in exchange.calls[0]


async def test_a_malformed_agent_id_is_left_out_not_sent(exchange):
    body = {
        "references": {"workflow": {"id": "not-a-uuid"}},
        "data": {"parameters": _agent(tools=[GMAIL])},
    }
    await auth_module.get_credentials(_BodyRequest(body), "http://agenta.test")
    assert "workflow_id" not in exchange.calls[0]

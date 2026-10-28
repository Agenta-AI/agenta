"""A person's own Composio connection (M7).

Spec: personal-credentials ("User owner for credentials", "One personal account per
service", "Personal credentials end when the owner leaves") and connection-bindings.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import oss.src.core.credentials.policy as policy_module
from oss.src.core.access.context import reset_request_access, set_request_access
import oss.src.core.credentials.selection as selection_module
from oss.src.core.credentials.bindings import Binding, BindingClaim, tool_key
from oss.src.core.credentials.lifecycle import PersonalCredentialsService
from oss.src.core.credentials.policy import PersonalCredentialRefused
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    provider_entity,
)
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateway.connections.utils import decode_oauth_state
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.tools.service import ToolsService
from oss.src.utils.env import env
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

GMAIL = BindingClaim(
    key=tool_key(integration="gmail", slug="gmail-support"),
    binding=Binding.CALLER_ACCOUNT,
)


@pytest.fixture(autouse=True)
def _open_gate(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "personal_credentials_enabled", True)
    monkeypatch.setattr(policy_module, "is_ee", lambda: False)

    async def private_session(*, project_id, session_id):
        return True

    selection_module.set_personal_use_guard(private_session)
    yield
    selection_module.set_personal_use_guard(None)


def _connection(*, owner=None, project_id=None, slug="gmail-support"):
    return Connection(
        id=uuid4(),
        slug=slug,
        provider_key="composio",
        integration_key="gmail",
        flags={"is_active": True, "is_valid": True},
        data={"connected_account_id": "ca_1"}
        | ({"project_id": str(project_id)} if project_id else {}),
        owner=owner,
    )


def _owner(organization_id, user_id):
    return SecretOwner(
        kind=SecretOwnerKind.USER, id=user_id, organization_id=organization_id
    )


def test_the_provider_entity_is_computed_from_the_owner():
    organization_id, user_id, project_id = uuid4(), uuid4(), uuid4()
    personal = _connection(owner=_owner(organization_id, user_id))
    assert provider_entity(personal) == f"org:{organization_id}:user:{user_id}"
    assert provider_entity(_connection(project_id=project_id)) == str(project_id)


async def test_bob_connects_his_own_gmail():
    organization_id, project_id, bob = uuid4(), uuid4(), uuid4()
    adapter = MagicMock()
    adapter.initiate_connection = AsyncMock(
        return_value=SimpleNamespace(
            connection_data={"connected_account_id": "ca_bob", "redirect_url": "u"}
        )
    )
    dao = MagicMock()
    dao.create_connection = AsyncMock(side_effect=lambda **kw: kw)
    service = ConnectionsService(
        connections_dao=dao, adapter_registry=MagicMock(get=lambda _: adapter)
    )

    created = await service.initiate_connection(
        project_id=project_id,
        user_id=bob,
        connection_create=ConnectionCreate(
            slug="gmail", provider_key="composio", integration_key="gmail"
        ),
        owner=_owner(organization_id, bob),
    )

    request = adapter.initiate_connection.await_args.kwargs["request"]
    assert request.user_id == f"org:{organization_id}:user:{bob}"
    state = decode_oauth_state(
        request.callback_url.split("state=", 1)[1], secret_key=env.agenta.crypt_key
    )
    assert state["owner"] == "user"
    assert state["organization_id"] == str(organization_id)
    assert state["user_id"] == str(bob)
    assert created["project_id"] is None
    assert created["owner"] == _owner(organization_id, bob)
    assert "project_id" not in created["connection_create"].data


@contextmanager
def _run(*, organization_id, principal_id, kind="human", bindings=()):
    envelope = make_envelope(
        kind=kind, principal_id=principal_id, organization_id=organization_id
    )
    access = make_request_access(
        envelope=envelope, credential_kind="run_credential"
    ).model_copy(update={"bindings": tuple(bindings), "session_id": "s-private"})
    token = set_request_access(access)
    try:
        yield
    finally:
        reset_request_access(token)


def _tools(*, personal=(), project=()):
    connections = MagicMock()
    connections.query_personal_connections = AsyncMock(return_value=list(personal))
    connections.query_connections = AsyncMock(return_value=list(project))
    return ToolsService(
        connections_service=connections,
        catalog_service=MagicMock(),
        adapter_registry=MagicMock(),
    ), connections


async def test_a_bound_integration_uses_the_persons_own_connection():
    organization_id, alice = uuid4(), uuid4()
    mine = _connection(owner=_owner(organization_id, alice), slug="gmail")
    shared = _connection(project_id=uuid4())
    tools, connections = _tools(personal=[mine], project=[shared])

    with _run(organization_id=organization_id, principal_id=alice, bindings=[GMAIL]):
        resolved = await tools.resolve_connection_by_slug(
            project_id=uuid4(),
            provider_key="composio",
            integration_key="gmail",
            connection_slug="gmail-support",
        )
    assert resolved.id == mine.id
    assert provider_entity(resolved) == f"org:{organization_id}:user:{alice}"
    connections.query_connections.assert_not_awaited()
    kwargs = connections.query_personal_connections.await_args.kwargs
    assert kwargs["user_id"] == alice and kwargs["organization_id"] == organization_id


async def test_without_the_binding_the_project_connection_answers():
    shared = _connection(project_id=uuid4())
    tools, connections = _tools(personal=[], project=[shared])
    with _run(organization_id=uuid4(), principal_id=uuid4(), bindings=()):
        resolved = await tools.resolve_connection_by_slug(
            project_id=uuid4(),
            provider_key="composio",
            integration_key="gmail",
            connection_slug="gmail-support",
        )
    assert resolved.id == shared.id
    connections.query_personal_connections.assert_not_awaited()


async def test_a_person_without_gmail_is_refused_never_the_project_one():
    tools, connections = _tools(personal=[], project=[_connection(project_id=uuid4())])
    with _run(organization_id=uuid4(), principal_id=uuid4(), bindings=[GMAIL]):
        with pytest.raises(PersonalCredentialRefused) as refused:
            await tools.resolve_connection_by_slug(
                project_id=uuid4(),
                provider_key="composio",
                integration_key="gmail",
                connection_slug="gmail-support",
            )
    assert refused.value.message == "Connect your Gmail account to use this agent."
    connections.query_connections.assert_not_awaited()


async def test_a_service_key_run_is_refused():
    tools, _ = _tools(personal=[_connection(owner=_owner(uuid4(), uuid4()))])
    with _run(
        organization_id=uuid4(), principal_id=uuid4(), kind="api_key", bindings=[GMAIL]
    ):
        with pytest.raises(PersonalCredentialRefused) as refused:
            await tools.resolve_connection_by_slug(
                project_id=uuid4(),
                provider_key="composio",
                integration_key="gmail",
                connection_slug="gmail-support",
            )
    assert refused.value.code == "no_person"


async def test_leaving_the_organization_ends_the_persons_credentials():
    organization_id, alice = uuid4(), uuid4()
    vault = MagicMock()
    vault.list_personal_secrets = AsyncMock(
        return_value=[SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]
    )
    vault.delete_personal_secret = AsyncMock(return_value=True)
    connections = MagicMock()
    connections.delete_personal_connections = AsyncMock(return_value=1)
    service = PersonalCredentialsService(
        vault_service=vault, connections_service=connections
    )
    assert (
        await service.end_for_member(organization_id=organization_id, user_id=alice)
        == 3
    )
    for call in vault.delete_personal_secret.await_args_list:
        assert call.kwargs["organization_id"] == organization_id
    connections.delete_personal_connections.assert_awaited_once_with(
        organization_id=organization_id, user_id=alice
    )


async def test_a_failed_provider_revoke_does_not_block_the_delete():
    organization_id, alice = uuid4(), uuid4()
    adapter = MagicMock()
    adapter.revoke_connection = AsyncMock(side_effect=RuntimeError("provider down"))
    dao = MagicMock()
    dao.query_owned_connections = AsyncMock(
        return_value=[_connection(owner=_owner(organization_id, alice))]
    )
    dao.delete_owned_connections = AsyncMock(return_value=1)
    service = ConnectionsService(
        connections_dao=dao, adapter_registry=MagicMock(get=lambda _: adapter)
    )
    assert (
        await service.delete_personal_connections(
            organization_id=organization_id, user_id=alice
        )
        == 1
    )


async def test_another_entry_of_the_same_integration_keeps_the_project_account():
    """The binding names its own entry (integration and slug). A second Gmail entry
    that names the project's support connection still uses that connection."""
    organization_id, alice = uuid4(), uuid4()
    mine = _connection(owner=_owner(organization_id, alice), slug="gmail")
    shared = _connection(project_id=uuid4(), slug="gmail-shared")
    tools, _ = _tools(personal=[mine], project=[shared])
    with _run(organization_id=organization_id, principal_id=alice, bindings=[GMAIL]):
        resolved = await tools.resolve_connection_by_slug(
            project_id=uuid4(),
            provider_key="composio",
            integration_key="gmail",
            connection_slug="gmail-shared",
        )
    assert resolved.id == shared.id


async def test_an_unsigned_personal_entry_is_refused_at_resolve():
    from oss.src.core.tools.dtos import GatewayConnectionTool  # noqa: PLC0415

    tools, connections = _tools(project=[_connection(project_id=uuid4())])
    ref = GatewayConnectionTool.model_validate(
        {
            "type": "gateway_connection",
            "connection": {
                "provider": "composio",
                "integration": "gmail",
                "slug": "gmail-support",
                "binding": "caller_account",
            },
        }
    )
    with _run(organization_id=uuid4(), principal_id=uuid4(), bindings=()):
        with pytest.raises(PersonalCredentialRefused) as refused:
            await tools._resolve_gateway_connection(project_id=uuid4(), ref=ref)
    assert refused.value.code == "binding_not_signed"
    connections.query_connections.assert_not_awaited()

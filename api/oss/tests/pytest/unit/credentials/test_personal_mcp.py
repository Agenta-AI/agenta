"""A person's own MCP server (M7): reached only through a signed `user`-scope binding,
never the project's server of the same slug."""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

import oss.src.core.credentials.policy as policy_module
import oss.src.core.credentials.selection as selection_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.credentials.bindings import Binding, BindingClaim, mcp_key
from oss.src.core.credentials.policy import PersonalCredentialRefused
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import MCPEndpointCreate
from oss.src.core.gateways.mcps.service import MCPGatewayService
from oss.src.core.gateways.mcps.types import (
    MCPEndpointNotFoundError,
    PersonalMCPAuthNotSupportedError,
)
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.utils.env import env
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

NOTES = BindingClaim(key=mcp_key(slug="notes"), binding=Binding.CALLER_ACCOUNT)


@pytest.fixture(autouse=True)
def _open_gate(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "personal_credentials_enabled", True)
    monkeypatch.setattr(policy_module, "is_ee", lambda: False)

    async def private_session(*, project_id, session_id):
        return True

    selection_module.set_personal_use_guard(private_session)
    yield
    selection_module.set_personal_use_guard(None)


@contextmanager
def _run(*, organization_id, principal_id, bindings=()):
    access = make_request_access(
        envelope=make_envelope(
            kind="human", principal_id=principal_id, organization_id=organization_id
        ),
        credential_kind="run_credential",
    ).model_copy(update={"bindings": tuple(bindings), "session_id": "s-private"})
    token = set_request_access(access)
    try:
        yield
    finally:
        reset_request_access(token)


def _service(servers):
    dao = MagicMock()

    async def fetch(*, owner, slug):
        return servers.get((owner, slug))

    dao.fetch_owned_endpoint_by_slug = AsyncMock(side_effect=fetch)
    dao.fetch_endpoint_by_slug = AsyncMock(
        side_effect=AssertionError("the project's server is never read")
    )
    dao.create_endpoint = AsyncMock(side_effect=lambda **kw: kw)
    service = MCPGatewayService.__new__(MCPGatewayService)
    service.mcp_endpoints_dao = dao
    return service, dao


def _owner(organization_id, user_id):
    return SecretOwner.for_user(organization_id=organization_id, user_id=user_id)


async def _target(service, slug="notes"):
    return await service._resolve_target(
        project_id=uuid4(),
        namespace=GatewayEndpointNamespace.USER,
        name=slug,
        provider=None,
        integration=None,
    )


async def test_two_people_each_reach_their_own_server():
    organization_id, alice, bob = uuid4(), uuid4(), uuid4()
    servers = {
        (_owner(organization_id, alice), "notes"): "alice-notes",
        (_owner(organization_id, bob), "notes"): "bob-notes",
    }
    service, _ = _service(servers)
    for person, expected in ((alice, "alice-notes"), (bob, "bob-notes")):
        with _run(
            organization_id=organization_id, principal_id=person, bindings=[NOTES]
        ):
            target = await _target(service)
        assert target.endpoint == expected


async def test_without_a_server_the_person_is_refused_not_the_project_server():
    service, dao = _service({})
    with _run(organization_id=uuid4(), principal_id=uuid4(), bindings=[NOTES]):
        with pytest.raises(PersonalCredentialRefused) as refused:
            await _target(service)
    assert refused.value.code == "personal_account_missing"
    dao.fetch_endpoint_by_slug.assert_not_awaited()


async def test_without_the_binding_the_personal_route_answers_nothing():
    organization_id, alice = uuid4(), uuid4()
    service, _ = _service({(_owner(organization_id, alice), "notes"): "alice-notes"})
    with _run(organization_id=organization_id, principal_id=alice, bindings=()):
        with pytest.raises(MCPEndpointNotFoundError):
            await _target(service)


async def test_a_personal_server_needs_no_sign_in_for_now():
    service, dao = _service({})
    with pytest.raises(PersonalMCPAuthNotSupportedError):
        await service.create_personal_endpoint(
            organization_id=uuid4(),
            user_id=uuid4(),
            endpoint=MCPEndpointCreate.model_validate(
                {
                    "slug": "notes",
                    "name": "Notes",
                    "auth_mode": "oauth",
                    "data": {"route": {"base_url": "https://notes.example/mcp"}},
                }
            ),
        )
    dao.create_endpoint.assert_not_awaited()


async def test_a_personal_server_is_stored_with_its_owner():
    organization_id, alice = uuid4(), uuid4()
    service, dao = _service({})
    created = await service.create_personal_endpoint(
        organization_id=organization_id,
        user_id=alice,
        endpoint=MCPEndpointCreate.model_validate(
            {
                "slug": "notes",
                "name": "Notes",
                "auth_mode": "none",
                "data": {"route": {"base_url": "https://notes.example/mcp"}},
            }
        ),
    )
    assert created["project_id"] is None
    assert created["owner"] == _owner(organization_id, alice)

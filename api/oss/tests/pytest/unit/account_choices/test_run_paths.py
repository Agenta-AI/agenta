"""How the run credential carries `run_accounts`, and how each path reads it."""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from jwt import decode, encode
from starlette.requests import Request

import oss.src.apis.fastapi.access.router as access_router_module
import oss.src.core.account_choices.policy as policy_module
import oss.src.core.account_choices.service as service_module
import oss.src.core.tools.service as tools_service_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.account_choices.claims import run_accounts_from_claim
from oss.src.core.account_choices.lifecycle import AccountsLifecycle
from oss.src.core.gateways.run_claims import run_accounts
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.tools.exceptions import ConnectionNotFoundError
from oss.src.core.tools.service import ToolsService
from oss.src.middlewares import auth
from oss.tests.pytest.utils.principals import (
    envelope_for_claims,
    make_envelope,
    make_request_access,
)

SECRET_KEY = "unit-test-secret-key-with-32-bytes"
U = "00000000-0000-4000-8000-0000000000a1"
P = "00000000-0000-4000-8000-0000000000b2"
O = "00000000-0000-4000-8000-0000000000c3"  # noqa: E741
GMAIL = "app_connection:user/gmail"


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/tools/call",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture
def signing_key(monkeypatch):
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)


@pytest.fixture
def switch_on(monkeypatch):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )


async def test_the_claim_survives_sign_verify_and_re_mint(signing_key):
    connection_id = str(uuid4())
    claim = [{"item_key": GMAIL, "gateway_connection_id": connection_id}]
    envelope = envelope_for_claims(user_id=U, project_id=P, organization_id=O)
    token = await auth.sign_secret_token(
        user_id=U,
        project_id=P,
        organization_id=O,
        envelope=envelope,
        run_accounts=claim,
    )
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    (account,) = request.state.run_accounts
    assert account.item_key == GMAIL and str(account.gateway_connection_id) == (
        connection_id
    )
    # A route that re-mints copies the claim unchanged.
    assert run_accounts(request) == claim

    plain = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=envelope
    )
    payload = decode(
        plain, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )
    assert "run_accounts" not in payload


async def test_a_token_with_a_malformed_claim_is_refused(signing_key):
    envelope = envelope_for_claims(user_id=U, project_id=P, organization_id=O)
    token = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=envelope
    )
    payload = decode(
        token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )
    payload["run_accounts"] = [{"item_key": GMAIL, "secret_id": "not-an-id"}]
    forged = encode(payload, SECRET_KEY, algorithm="HS256")
    with pytest.raises(Exception):
        await auth.verify_secret_token(request=_request(), secret_token=forged)


class _Choices:
    def __init__(self):
        self.calls = []

    async def resolve(self, **kwargs):
        self.calls.append(kwargs)
        return []


async def test_the_exchange_reads_nothing_without_item_keys(switch_on, monkeypatch):
    choices = _Choices()
    monkeypatch.setattr(service_module, "_account_choices_service", choices)
    envelope = make_envelope(kind="human")
    token = set_request_access(
        make_request_access(envelope=envelope, credential_kind="bearer_session")
    )
    try:
        assert (
            await access_router_module._run_accounts_of_exchange(
                _request(), envelope=envelope, workflow_id=uuid4(), item_keys=None
            )
            is None
        )
        assert choices.calls == []
        await access_router_module._run_accounts_of_exchange(
            _request(),
            envelope=envelope,
            workflow_id=uuid4(),
            item_keys=[GMAIL, "not a key"],
        )
        (call,) = choices.calls
        assert [item.item_key for item in call["items"]] == [GMAIL]
        assert call["user_id"] == envelope.authority.principal.id
    finally:
        reset_request_access(token)


async def test_the_exchange_carries_a_run_credentials_claim(switch_on, monkeypatch):
    choices = _Choices()
    monkeypatch.setattr(service_module, "_account_choices_service", choices)
    envelope = make_envelope(kind="human")
    claim = [{"item_key": GMAIL, "gateway_connection_id": str(uuid4())}]
    access = make_request_access(
        envelope=envelope, credential_kind="run_credential"
    ).model_copy(update={"run_accounts": run_accounts_from_claim(claim)})
    request = _request()
    request.state.run_accounts = access.run_accounts
    token = set_request_access(access)
    try:
        carried = await access_router_module._run_accounts_of_exchange(
            request, envelope=envelope, workflow_id=uuid4(), item_keys=[GMAIL]
        )
    finally:
        reset_request_access(token)
    assert carried == claim
    assert choices.calls == []


def _tools_service(rows):
    service = object.__new__(ToolsService)

    async def get_connection(**kwargs):
        rows.append(kwargs)
        return rows[0] if isinstance(rows[0], SimpleNamespace) else None

    service.get_connection = get_connection
    return service


def _connection(owner_id: UUID, organization_id: UUID):
    return SimpleNamespace(
        provider_key=SimpleNamespace(value="composio"),
        integration_key="gmail",
        is_active=True,
        is_valid=True,
        has_auth=True,
        provider_connection_id="ca_1",
        user_id=owner_id,
        organization_id=organization_id,
        data={},
    )


async def test_a_user_tool_reads_the_claims_connection_by_id():
    person = uuid4()
    envelope = make_envelope(kind="human", principal_id=person)
    connection_id = uuid4()
    access = make_request_access(
        envelope=envelope, credential_kind="run_credential"
    ).model_copy(
        update={
            "run_accounts": run_accounts_from_claim(
                [{"item_key": GMAIL, "gateway_connection_id": str(connection_id)}]
            )
        }
    )
    connection = _connection(person, envelope.authority.organization_id)
    calls = [connection]
    service = _tools_service(calls)
    token = set_request_access(access)
    try:
        resolved = await service.resolve_run_person_connection(
            provider_key="composio", integration_key="gmail"
        )
    finally:
        reset_request_access(token)
    assert resolved is connection
    read = calls[1]
    assert read["connection_id"] == connection_id
    assert read["owner"].id == person
    assert read["owner"].organization_id == envelope.authority.organization_id
    assert tools_service_module.composio_user_of(connection) == (
        f"org:{envelope.authority.organization_id}:user:{person}"
    )


async def test_a_user_tool_without_an_entry_is_not_found_and_reads_nothing():
    access = make_request_access(
        envelope=make_envelope(kind="human"), credential_kind="run_credential"
    )
    calls = [None]
    service = _tools_service(calls)
    token = set_request_access(access)
    try:
        with pytest.raises(ConnectionNotFoundError):
            await service.resolve_run_person_connection(
                provider_key="composio", integration_key="gmail"
            )
    finally:
        reset_request_access(token)
    assert calls == [None]


async def test_leaving_an_organization_ends_the_persons_accounts():
    organization_id, user_id = uuid4(), uuid4()
    removed = []

    class _Vault:
        async def delete_personal_secrets(self, **kwargs):
            removed.append(("secrets", kwargs))
            return 2

    class _Connections:
        async def delete_personal_connections(self, **kwargs):
            removed.append(("connections", kwargs))
            return 1

    class _Dao:
        async def remove_member(self, **kwargs):
            return SimpleNamespace(user_id=user_id, deleted_invitation_count=0)

    service = object.__new__(MembershipsService)
    service._dao = _Dao()
    service._member_removed_hook = None

    async def no_invalidate(**kwargs):
        return None

    service._invalidate_organization = no_invalidate
    service.set_member_removed_hook(
        AccountsLifecycle(
            vault_service=_Vault(), connections_service=_Connections()
        ).end_for_member
    )
    await service.remove_member(organization_id=organization_id, email="x@example.com")
    assert [name for name, _ in removed] == ["secrets", "connections"]
    assert all(
        call == {"organization_id": organization_id, "user_id": user_id}
        for _, call in removed
    )

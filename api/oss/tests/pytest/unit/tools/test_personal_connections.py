"""A person's own Composio connections: the routes, the service, the OAuth state."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.core.account_choices.policy as policy_module
import oss.src.core.gateway.connections.service as connections_service_module
from oss.src.apis.fastapi.tools.models import ToolConnectionCreateRequest
from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.gateway.connections.dtos import (
    Connection,
    ConnectionCreate,
    ConnectionProviderKind,
    entity_for,
)
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateway.connections.utils import decode_oauth_state
from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.tools.dtos import (
    ToolConnection,
    ToolConnectionCreate,
    ToolProviderKind,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access
from oss.tests.pytest.utils.sharing import NoopRunAdmission

KEY = "k" * 32


@pytest.fixture
def switch_on(monkeypatch):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )


@pytest.fixture
def person():
    organization_id, user_id = uuid4(), uuid4()
    access = make_request_access(
        envelope=make_envelope(kind="human", principal_id=user_id),
        credential_kind="bearer_session",
    )
    token = set_request_access(access)
    yield SimpleNamespace(
        organization_id=organization_id,
        user_id=user_id,
        request=SimpleNamespace(
            state=SimpleNamespace(
                project_id=str(uuid4()),
                user_id=str(user_id),
                organization_id=str(organization_id),
            ),
            headers={},
        ),
    )
    reset_request_access(token)


def _connection(**fields) -> Connection:
    return Connection(
        id=uuid4(),
        slug="gmail-main",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="gmail",
        **fields,
    )


class _Service:
    def __init__(self, owned=None):
        self.owned = owned
        self.calls = []

    async def get_connection(self, **kwargs):
        self.calls.append(("get_connection", kwargs))
        if kwargs.get("owner") is not None:
            return self.owned
        return _connection()

    async def delete_connection(self, **kwargs):
        self.calls.append(("delete_connection", kwargs))
        return True

    async def make_default(self, **kwargs):
        self.calls.append(("make_default", kwargs))
        return self.owned

    async def query_personal_connections(self, **kwargs):
        self.calls.append(("query_personal_connections", kwargs))
        return []

    async def create_connection(self, **kwargs):
        self.calls.append(("create_connection", kwargs))
        return ToolConnection.model_validate(_connection(is_default=True).model_dump())


def _router(service):
    return ToolsRouter(run_admission=NoopRunAdmission(), tools_service=service)


async def test_query_with_scope_user_lists_the_callers_own(switch_on, person):
    service = _Service()
    response = await _router(service).query_connections(
        person.request, integration_key="gmail", scope="user"
    )
    assert response.count == 0
    name, kwargs = service.calls[0]
    assert name == "query_personal_connections"
    assert kwargs["user_id"] == person.user_id
    assert kwargs["organization_id"] == person.organization_id
    assert kwargs["integration_key"] == "gmail"


async def test_create_with_scope_user_passes_the_person_owner(switch_on, person):
    service = _Service()
    body = ToolConnectionCreateRequest(
        connection=ToolConnectionCreate(
            slug="gmail-main",
            provider_key=ToolProviderKind.COMPOSIO,
            integration_key="gmail",
        )
    )
    await _router(service).create_connection(person.request, body=body, scope="user")
    _, kwargs = service.calls[0]
    assert kwargs["owner"] == SecretOwner.for_user(
        organization_id=person.organization_id, user_id=person.user_id
    )


async def test_scope_user_is_off_with_the_switch(person):
    with pytest.raises(HTTPException) as error:
        await _router(_Service()).query_connections(person.request, scope="user")
    assert error.value.status_code == 403
    assert error.value.detail["code"] == "personal_accounts_disabled"


async def test_a_by_id_route_acts_on_the_callers_own_row(switch_on, person):
    service = _Service(owned=_connection())
    await _router(service).delete_connection(person.request, uuid4())
    name, kwargs = service.calls[-1]
    assert name == "delete_connection"
    assert kwargs["owner"].id == person.user_id


async def test_a_by_id_route_falls_back_to_the_project_with_its_permission(
    switch_on, person, monkeypatch
):
    asked = []

    async def allow(**kwargs):
        asked.append(kwargs["permission"])
        return True

    monkeypatch.setattr("oss.src.apis.fastapi.tools.router.check_action_access", allow)
    service = _Service(owned=None)
    await _router(service).delete_connection(person.request, uuid4())
    _, kwargs = service.calls[-1]
    assert kwargs["owner"] is None
    assert len(asked) == 1


async def test_make_default_of_another_persons_connection_is_not_found(
    switch_on, person
):
    with pytest.raises(HTTPException) as error:
        await _router(_Service(owned=None)).make_default_connection(
            person.request, uuid4()
        )
    assert error.value.status_code == 404
    assert error.value.detail["code"] == "not_found"


def test_the_composio_user_of_a_person_is_their_entity():
    organization_id, user_id = uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=user_id)
    assert entity_for(owner=owner, project_id=uuid4()) == (
        f"org:{organization_id}:user:{user_id}"
    )
    project_id = uuid4()
    assert entity_for(owner=None, project_id=project_id) == str(project_id)


async def test_initiate_for_a_person_stores_no_project_and_signs_the_owner(
    monkeypatch,
):
    captured = {}

    class _Adapter:
        async def initiate_connection(self, *, request):
            captured["request"] = request
            return SimpleNamespace(
                connection_data={"connected_account_id": "ca_1"},
                redirect_url="https://example.test",
            )

    class _Dao:
        async def create_connection(self, **kwargs):
            captured["create"] = kwargs
            return _connection()

    service = ConnectionsService(
        connections_dao=_Dao(),
        adapter_registry=SimpleNamespace(get=lambda _key: _Adapter()),
    )
    monkeypatch.setattr(
        connections_service_module,
        "env",
        SimpleNamespace(
            agenta=SimpleNamespace(crypt_key=KEY, api_url="http://api.test")
        ),
    )
    organization_id, user_id, project_id = uuid4(), uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=user_id)
    await service.initiate_connection(
        project_id=project_id,
        user_id=user_id,
        connection_create=ConnectionCreate(
            slug="gmail-main",
            provider_key=ConnectionProviderKind.COMPOSIO,
            integration_key="gmail",
        ),
        owner=owner,
    )
    assert captured["request"].user_id == f"org:{organization_id}:user:{user_id}"
    assert captured["create"]["project_id"] is None
    assert captured["create"]["owner"] == owner
    assert "project_id" not in captured["create"]["connection_create"].data
    state = captured["request"].callback_url.split("state=", 1)[1]
    payload = decode_oauth_state(state, secret_key=KEY)
    assert payload["owner"] == "user"
    assert payload["organization_id"] == str(organization_id)
    assert payload["user_id"] == str(user_id)


async def test_the_callback_activates_nothing_while_the_switch_is_off(monkeypatch):
    from oss.src.core.gateway.connections.utils import make_oauth_state
    import oss.src.apis.fastapi.tools.router as router_module

    monkeypatch.setattr(router_module.env.agenta, "crypt_key", KEY)
    service = SimpleNamespace(activate_personal_connection=None)
    state = make_oauth_state(
        project_id=uuid4(),
        user_id=uuid4(),
        secret_key=KEY,
        slug="gmail-main",
        integration_key="gmail",
        user_organization_id=uuid4(),
    )
    response = await _router(service).callback_connection(
        SimpleNamespace(state=SimpleNamespace(), headers={}),
        connected_account_id="ca_1",
        status="success",
        error_message=None,
        state=state,
    )
    assert response.status_code == 403

"""The auth middleware sets the request principal (M2): `request.state.principal`,
`.authority`, `.credential_kind`, `.run_envelope`, and the `RequestAccess` context."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from jwt import encode
from starlette.requests import Request
from starlette.responses import JSONResponse

import oss.src.core.memberships.service as memberships_module
from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    RequestCredentialKind,
    RunOrigin,
)
from oss.src.core.access.principals import envelope_to_claims
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.middlewares import auth
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary
from oss.tests.pytest.utils.principals import make_envelope


SECRET_KEY = "unit-test-secret-key-with-32-bytes"


def _request(path="/projects/", headers=None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [
                (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
            ],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture
def cache(monkeypatch):
    fake = FakeCache().install(monkeypatch, auth, memberships_module)
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)
    return fake


# -- Bearer -------------------------------------------------------------------------


@pytest.fixture
def bearer_world(monkeypatch, cache):
    user = uuid4()
    dao = InMemoryMembershipsDAO()
    project = dao.add_project(make_summary())
    dao.add_organization_member(
        organization_id=project.organization_id, user_id=user, role="editor"
    )
    monkeypatch.setattr(
        memberships_module,
        "_memberships_service",
        MembershipsService(
            memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
        ),
    )

    async def _get_session(request):
        return SimpleNamespace(get_user_id=lambda: "supertokens-user")

    async def _project(project_id):
        return SimpleNamespace(
            id=project.project_id,
            workspace_id=project.workspace_id,
            organization_id=project.organization_id,
            organization=SimpleNamespace(name="Org"),
        )

    async def _workspace(workspace_id):
        return SimpleNamespace(
            id=project.workspace_id, organization_id=project.organization_id
        )

    async def _default_workspace(user_id):
        return str(project.workspace_id)

    async def _default_project(workspace_id):
        return str(project.project_id)

    monkeypatch.setattr(auth, "get_session", _get_session)
    monkeypatch.setattr(auth.db_manager, "get_project_by_id", _project)
    monkeypatch.setattr(auth.db_manager, "get_workspace", _workspace)
    monkeypatch.setattr(auth.db_manager, "get_default_workspace_id", _default_workspace)
    monkeypatch.setattr(
        auth.db_manager, "get_default_project_id_from_workspace", _default_project
    )
    # The SuperTokens user lookup is cached; prefill it.
    cache.store[_supertokens_name()] = auth_serialize(
        {"user_id": str(user), "user_email": "m@test.agenta.ai"}
    )
    return SimpleNamespace(user=user, project=project)


def _supertokens_name():
    from oss.src.utils import caching

    return caching._pack(
        namespace="get_supertokens_user_by_id", user_id="supertokens-user", key={}
    )


def auth_serialize(value):
    from oss.src.utils import caching

    return caching._serialize(value)


async def test_bearer_sets_human_state(bearer_world, cache):
    request = _request()
    await auth.verify_bearer_token(request=request, bearer_token="t")

    user = bearer_world.user
    assert request.state.principal == PrincipalRef(kind=PrincipalKind.HUMAN, id=user)
    assert request.state.credential_kind == RequestCredentialKind.BEARER_SESSION
    assert request.state.run_envelope is None
    assert request.state.authority.principal == request.state.principal
    assert request.state.authority.project_id == bearer_world.project.project_id
    assert request.state.authority.organization_id == (
        bearer_world.project.organization_id
    )
    # The cached state carries the principal.
    [name] = cache.names("verify_bearer_token")
    from oss.src.utils import caching

    stored = caching._deserialize(cache.store[name])
    assert stored["principal"] == {"kind": "human", "id": str(user)}


async def test_cached_bearer_state_without_principal_is_a_miss(bearer_world, cache):
    request = _request()
    await auth.verify_bearer_token(request=request, bearer_token="t")
    [name] = cache.names("verify_bearer_token")
    from oss.src.utils import caching

    old = caching._deserialize(cache.store[name])
    old.pop("principal")
    cache.store[name] = caching._serialize(old)  # what an M1 pod cached

    again = _request()
    await auth.verify_bearer_token(request=again, bearer_token="t")
    assert again.state.principal.kind == PrincipalKind.HUMAN
    assert "principal" in caching._deserialize(cache.store[name])


# -- ApiKey -------------------------------------------------------------------------


def _api_key_world(monkeypatch, *, user):
    key_id, project_id, organization_id = uuid4(), uuid4(), uuid4()
    calls = []

    async def _use_api_key(key):
        calls.append(key)
        return SimpleNamespace(
            id=key_id,
            project_id=project_id,
            created_by_id=uuid4() if user is None else user,
            user=None if user is None else SimpleNamespace(email="k@test.agenta.ai"),
        )

    async def _project(project_id):
        return SimpleNamespace(
            workspace_id=uuid4(),
            organization_id=organization_id,
            organization=SimpleNamespace(name="Org"),
        )

    monkeypatch.setattr(auth.api_key_service, "use_api_key", _use_api_key)
    monkeypatch.setattr(auth.db_manager, "get_project_by_id", _project)
    return SimpleNamespace(
        key_id=key_id,
        project_id=project_id,
        organization_id=organization_id,
        calls=calls,
    )


async def test_api_key_sets_principal_and_creator_user_id(monkeypatch, cache):
    creator = uuid4()
    world = _api_key_world(monkeypatch, user=creator)
    request = _request()
    await auth.verify_apikey_token(request=request, apikey_token="k.secret")

    assert request.state.user_id == str(creator)
    assert request.state.principal == PrincipalRef(
        kind=PrincipalKind.API_KEY, id=world.key_id
    )
    assert request.state.api_key_id == str(world.key_id)
    assert request.state.credential_kind == RequestCredentialKind.API_KEY
    assert request.state.authority.project_id == world.project_id

    # Warm: the cached state alone sets the same principal.
    again = _request()
    await auth.verify_apikey_token(request=again, apikey_token="k.secret")
    assert again.state.principal == request.state.principal
    assert world.calls == ["k.secret"]


async def test_cached_api_key_state_without_principal_is_a_miss(monkeypatch, cache):
    world = _api_key_world(monkeypatch, user=uuid4())
    await auth.verify_apikey_token(request=_request(), apikey_token="k.secret")
    [name] = cache.names("verify_apikey_token")
    from oss.src.utils import caching

    old = caching._deserialize(cache.store[name])
    old.pop("principal")
    old.pop("api_key_id")
    cache.store[name] = caching._serialize(old)

    again = _request()
    await auth.verify_apikey_token(request=again, apikey_token="k.secret")
    assert again.state.principal.id == world.key_id
    assert len(world.calls) == 2


async def test_api_key_whose_creator_is_missing_fails_as_today(monkeypatch, cache):
    """Today (measured on the M1 stack, ~/agenta-m2-qa/before/ghost-key-*.json): 401
    {"detail": {"message": "Unauthorized"}} on every request, nothing cached."""

    _api_key_world(monkeypatch, user=None)

    async def _next(request):  # pragma: no cover - never reached
        return JSONResponse({"ok": True})

    for _ in range(2):
        response = await auth.auth_middleware(
            _request(headers={"Authorization": "ApiKey ghost.secret"}), _next
        )
        assert response.status_code == 401
        assert response.body == b'{"detail":{"message":"Unauthorized"}}'
    assert cache.names("verify_apikey_token") == []


# -- Secret -------------------------------------------------------------------------


def _secret(*, envelope=None, project_id=None, organization_id=None, extra=None):
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": str(uuid4()),
        "project_id": str(project_id or uuid4()),
        "workspace_id": str(uuid4()),
        "organization_id": str(organization_id or uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    if envelope is not None:
        payload.update(envelope_to_claims(envelope=envelope))
    payload.update(extra or {})
    return encode(payload=payload, key=SECRET_KEY, algorithm="HS256")


async def test_secret_with_principal_claim_sets_claim_principal(cache):
    project_id, organization_id = uuid4(), uuid4()
    envelope = make_envelope(
        kind="api_key",
        origin="api",
        origin_id="k1",
        sender=None,
        project_id=project_id,
        organization_id=organization_id,
        run_id="turn-1",
    )
    request = _request()
    await auth.verify_secret_token(
        request=request,
        secret_token=_secret(
            envelope=envelope, project_id=project_id, organization_id=organization_id
        ),
    )
    assert request.state.run_envelope == envelope
    assert request.state.principal == envelope.authority.principal
    assert request.state.authority == envelope.authority
    assert request.state.credential_kind == RequestCredentialKind.RUN_CREDENTIAL


async def test_secret_without_principal_claim_has_no_principal(cache):
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=_secret())
    assert request.state.principal is None
    assert request.state.credential_kind is None


@pytest.mark.parametrize("case", ["unknown_kind", "extra_key", "other_project"])
async def test_secret_with_bad_claims_is_invalid_token(case, cache):
    from fastapi import HTTPException

    project_id, organization_id = uuid4(), uuid4()
    envelope = make_envelope(project_id=project_id, organization_id=organization_id)
    claims = envelope_to_claims(envelope=envelope)
    if case == "unknown_kind":
        claims["principal"]["kind"] = "service_account"
        token = _secret(
            project_id=project_id, organization_id=organization_id, extra=claims
        )
    elif case == "extra_key":
        claims["authority"]["surprise"] = 1
        token = _secret(
            project_id=project_id, organization_id=organization_id, extra=claims
        )
    else:
        token = _secret(
            envelope=envelope, project_id=uuid4(), organization_id=organization_id
        )

    with pytest.raises(HTTPException) as error:
        await auth.verify_secret_token(request=_request(), secret_token=token)
    assert error.value.status_code == 401
    assert auth._unauthorized_reason(error.value) == "invalid_token"


# -- RequestAccess and request_run_envelope -------------------------------------------


async def test_request_access_reset_after_request(monkeypatch, cache):
    project_id, organization_id = uuid4(), uuid4()
    envelope = make_envelope(project_id=project_id, organization_id=organization_id)
    token = _secret(
        envelope=envelope, project_id=project_id, organization_id=organization_id
    )
    seen = []

    async def _next(request):
        seen.append(get_request_access())
        return JSONResponse({"ok": True})

    async def _policy(request):
        return None

    monkeypatch.setattr(auth, "_check_organization_policy", _policy)
    response = await auth.auth_middleware(
        _request(headers={"Authorization": f"Secret {token}"}), _next
    )
    assert response.status_code == 200
    [access] = seen
    assert access.principal == envelope.authority.principal
    assert access.credential_kind == RequestCredentialKind.RUN_CREDENTIAL
    assert access.envelope == envelope
    assert get_request_access() is None


async def test_request_run_envelope_for_each_credential(
    bearer_world, monkeypatch, cache
):
    request = _request()
    await auth.verify_bearer_token(request=request, bearer_token="t")
    web = auth.request_run_envelope(request)
    assert web.context.origin == RunOrigin.WEB
    assert web.sender.user_id == bearer_world.user

    world = _api_key_world(monkeypatch, user=uuid4())
    request = _request()
    await auth.verify_apikey_token(request=request, apikey_token="k.secret")
    api = auth.request_run_envelope(request)
    assert api.context.origin == RunOrigin.API
    assert api.context.origin_id == str(world.key_id)
    assert api.sender is None

    project_id, organization_id = uuid4(), uuid4()
    envelope = make_envelope(project_id=project_id, organization_id=organization_id)
    request = _request()
    await auth.verify_secret_token(
        request=request,
        secret_token=_secret(
            envelope=envelope, project_id=project_id, organization_id=organization_id
        ),
    )
    assert auth.request_run_envelope(request) == envelope

    assert auth.request_run_envelope(_request()) is None

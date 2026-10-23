"""The `/access/permissions/check` exchange is the only place users' credentials become
grant-bearing runtime credentials — and only for an ALLOWED `run_service` exchange.

Drives the real `AccessRouter.check_permissions` handler with real token minting (the
returned credentials decode with the real key); only the permission verdict and the Redis
cache are faked.
"""

from uuid import uuid4

import pytest

from oss.tests.pytest.utils.principals import (
    envelope_for_claims,
    make_request_access,
)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import Decision, DecisionReason
from jwt import decode
from starlette.requests import Request

import oss.src.middlewares.auth as auth_module
from oss.src.apis.fastapi.access import router as access_router_module
from oss.src.apis.fastapi.access.router import AccessRouter
from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT
from oss.src.utils.env import env
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)


SECRET_KEY = "unit-test-secret-key-with-32-bytes"
RUNTIME_KEY = "unit-test-runtime-key-not-a-secret"

ORGANIZATION_ID = uuid4()
WORKSPACE_ID = uuid4()
PROJECT_ID = uuid4()
USER_ID = uuid4()


@pytest.fixture(name="exchange")
def _exchange(monkeypatch):
    monkeypatch.setattr(auth_module, "_SECRET_KEY", SECRET_KEY)
    monkeypatch.setattr(env.agenta, "services_internal_key", RUNTIME_KEY)

    verdict = {"action": True, "resource": True}

    calls = []

    class _Access:
        async def check_request(self, **kwargs):
            calls.append(kwargs)
            return Decision(
                allowed=verdict["action"],
                reason=(
                    DecisionReason.ROLE
                    if verdict["action"]
                    else DecisionReason.MISSING_CAPABILITY
                ),
            )

    async def _check_resource_access(**kwargs):
        return verdict["resource"]

    monkeypatch.setattr(access_router_module, "get_access_service", lambda: _Access())
    monkeypatch.setattr(
        access_router_module, "_check_resource_access", _check_resource_access
    )

    router = AccessRouter()

    async def run(
        action,
        resource_type="service",
        carried_grants=(),
        runtime_key=None,
        scope_type=None,
        scope_id=None,
        without_grants=False,
        credential_kind="bearer_session",
    ):
        """Run the exchange as a principal whose credential carries ``carried_grants``.

        A session or ApiKey principal never has any: `verify_secret_token` is the only
        path that populates `token_grants`, and only from a verified Secret token.
        ``runtime_key`` is what the caller presents as the platform-runtime secret.
        """
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/access/permissions/check",
                "headers": (
                    [(b"x-agenta-runtime-key", runtime_key.encode())]
                    if runtime_key is not None
                    else []
                ),
                "query_string": b"",
                "scheme": "http",
                "server": ("testserver", 80),
                "root_path": "",
            }
        )
        request.state.token_grants = tuple(carried_grants)
        request.state.run_envelope = envelope_for_claims(
            user_id=USER_ID, project_id=PROJECT_ID, organization_id=ORGANIZATION_ID
        )
        access_token = set_request_access(
            make_request_access(
                envelope=request.state.run_envelope,
                credential_kind=credential_kind,
                acting_user_id=USER_ID,
            )
        )

        token = set_auth_context(
            AuthContext(
                credentials=SecretCredentials(value="caller-token"),
                scope=AuthScope(
                    organization_id=ORGANIZATION_ID,
                    workspace_id=WORKSPACE_ID,
                    project_id=PROJECT_ID,
                    user_id=USER_ID,
                ),
            )
        )
        try:
            return await router.check_permissions(
                request,
                action=action,
                scope_type=scope_type,
                scope_id=scope_id,
                resource_type=resource_type,
                resource_id=None,
                without_grants=without_grants,
            )
        finally:
            reset_auth_context(token)
            reset_request_access(access_token)

    run.calls = calls
    return run, verdict


def _claims(header_value: str) -> dict:
    assert header_value.startswith("Secret ")
    return decode(
        jwt=header_value[len("Secret ") :],
        key=SECRET_KEY,
        algorithms=["HS256"],
        options={"verify_exp": False},
    )


def _body(response) -> dict:
    import json

    return json.loads(response.body)


@pytest.mark.asyncio
async def test_a_granted_caller_keeps_the_grant_through_the_exchange(exchange):
    # The refresh path: the workflow service and the runner re-exchange the granted
    # credential a run was started with, and must get one back or the run loses its
    # ability to read the secrets it was authorized to use.
    run, _ = exchange

    body = _body(await run("run_service", carried_grants=(SECRET_RESOLVE_GRANT,)))

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert claims["grants"] == [SECRET_RESOLVE_GRANT]
    assert claims["project_id"] == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_the_platform_runtime_is_issued_the_grant(exchange):
    # The path every product run takes: the workflow service exchanges the END USER's
    # credential on their behalf, so nothing about the token says "this is a run". The
    # runtime proves what it is with a secret only it holds.
    run, _ = exchange

    body = _body(await run("run_service", runtime_key=RUNTIME_KEY))

    claims = _claims(body["credentials"])
    assert claims["grants"] == [SECRET_RESOLVE_GRANT]


@pytest.mark.asyncio
async def test_a_wrong_runtime_key_is_not_the_runtime(exchange):
    run, _ = exchange

    body = _body(await run("run_service", runtime_key="not-the-key"))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_a_non_ascii_runtime_key_is_not_the_runtime(exchange):
    run, _ = exchange

    body = _body(await run("run_service", runtime_key="not-the-key-ÿ"))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_the_runtime_key_only_grants_a_run_exchange(exchange):
    run, _ = exchange

    body = _body(await run("view_secret", runtime_key=RUNTIME_KEY))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_an_unconfigured_deployment_grants_nobody(exchange, monkeypatch):
    # The placeholder is in the repo, so anyone could send it. A deployment that
    # configured no runtime key must issue no grant rather than accept a known string.
    monkeypatch.setattr(env.agenta, "services_internal_key", "replace-me")
    run, _ = exchange

    body = _body(await run("run_service", runtime_key="replace-me"))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_the_admin_key_is_not_runtime_proof(exchange, monkeypatch):
    monkeypatch.setattr(env.agenta, "services_internal_key", None)
    run, _ = exchange

    body = _body(await run("run_service", runtime_key=env.agenta.auth_key))

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_a_plain_caller_cannot_mint_the_grant_by_asking_for_it(exchange):
    # The escalation this closes: a member who may run a service could call the exchange
    # with their own session or ApiKey — neither of which carries a grant — and spend the
    # returned credential on the vault routes to read every write-only value in plaintext.
    run, _ = exchange

    body = _body(await run("run_service"))

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert "grants" not in claims


@pytest.mark.asyncio
async def test_an_unrelated_carried_grant_is_not_forwarded(exchange):
    run, _ = exchange

    body = _body(await run("run_service", carried_grants=("some-other-grant",)))

    claims = _claims(body["credentials"])
    assert "grants" not in claims


@pytest.mark.asyncio
async def test_non_run_actions_never_receive_the_grant(exchange):
    run, _ = exchange

    body = _body(await run("view_secret", resource_type="local_secrets"))

    assert body["effect"] == "allow"
    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_denied_exchange_returns_no_credential_at_all(exchange):
    run, verdict = exchange
    verdict["action"] = False

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await run("run_service")

    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_resource_denial_returns_no_runtime_credential(exchange):
    run, verdict = exchange
    verdict["resource"] = False

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await run("run_service", runtime_key=RUNTIME_KEY)

    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_missing_action_is_denied(exchange):
    run, _ = exchange

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as raised:
        await run(None)

    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_a_project_scope_must_match_the_authenticated_project(exchange):
    # The scope check ASSERTS the requested scope is the authenticated one; it never
    # selects it. A caller asking about another project than the one its request was
    # authenticated for (for a session with no explicit project_id, the DEFAULT
    # project) is denied, whatever its role there. Clients must pin the request's
    # auth scope to the project they ask about (see useProjectPermission.ts).
    run, _ = exchange

    body = _body(await run("edit_secret", scope_type="project", scope_id=PROJECT_ID))
    assert body["effect"] == "allow"

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as denied:
        await run("edit_secret", scope_type="project", scope_id=uuid4())
    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_without_grants_drops_a_carried_grant(exchange):
    # The code evaluator sandbox runs user-written code. The service asks for the same
    # credential with no grant, so that code cannot read write-only vault values or
    # exchange it for a platform-run gateway token.
    run, _ = exchange

    body = _body(
        await run(
            "run_service",
            carried_grants=(SECRET_RESOLVE_GRANT,),
            without_grants=True,
        )
    )

    assert body["effect"] == "allow"
    claims = _claims(body["credentials"])
    assert "grants" not in claims
    assert claims["project_id"] == str(PROJECT_ID)
    assert claims["user_id"] == str(USER_ID)


@pytest.mark.asyncio
async def test_without_grants_wins_over_the_runtime_key(exchange):
    run, _ = exchange

    body = _body(
        await run(
            "run_service",
            carried_grants=(SECRET_RESOLVE_GRANT,),
            runtime_key=RUNTIME_KEY,
            without_grants=True,
        )
    )

    assert "grants" not in _claims(body["credentials"])


@pytest.mark.asyncio
async def test_a_grant_free_credential_cannot_get_the_grant_back(exchange):
    # What the sandbox holds, exchanged again without the runtime key, stays grant-free.
    run, _ = exchange

    narrowed = _body(
        await run(
            "run_service",
            carried_grants=(SECRET_RESOLVE_GRANT,),
            without_grants=True,
        )
    )["credentials"]
    carried = tuple(_claims(narrowed).get("grants") or ())

    body = _body(await run("run_service", carried_grants=carried))

    assert "grants" not in _claims(body["credentials"])


# -- M2: the exchange decides for the request principal, then mints -----------------


@pytest.mark.asyncio
async def test_exchange_copies_envelope_and_never_upgrades(exchange):
    run, _ = exchange

    body = _body(await run("run_service"))

    claims = _claims(body["credentials"])
    assert claims["principal"] == {"kind": "human", "id": str(USER_ID)}
    assert claims["authority"]["project_id"] == str(PROJECT_ID)


@pytest.mark.asyncio
async def test_exchange_mints_only_after_allow(exchange, monkeypatch):
    run, verdict = exchange
    minted = []
    real_sign = access_router_module.sign_secret_token

    async def _spy(**kwargs):
        minted.append(kwargs)
        return await real_sign(**kwargs)

    monkeypatch.setattr(access_router_module, "sign_secret_token", _spy)

    for action, resource in ((False, True), (True, False)):
        verdict.update(action=action, resource=resource)
        with pytest.raises(access_router_module.Deny):
            await run("run_service")
    with pytest.raises(access_router_module.Deny):
        await run(None)
    assert minted == []

    verdict.update(action=True, resource=True)
    await run("run_service")
    assert len(minted) == 1


@pytest.mark.asyncio
async def test_exchange_has_no_cache():
    assert not hasattr(access_router_module, "get_cache")
    assert not hasattr(access_router_module, "set_cache")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["bearer_session", "api_key", "run_credential"])
async def test_exchange_passes_the_auth_scope_project(exchange, kind):
    run, _ = exchange

    await run("run_service", credential_kind=kind)

    call = run.calls[-1]
    assert call["project_id"] == PROJECT_ID
    assert call["access"].credential_kind.value == kind
    assert call["action"].value == "run_service"


@pytest.mark.asyncio
async def test_exchange_denies_an_inactive_principal(exchange, monkeypatch):
    """The real decision: an inactive principal record (a deleted key, a deleted
    user) is refused before any membership read, so no cached answer can allow it."""

    from oss.src.core.access.dtos import PrincipalKind, PrincipalRecord, PrincipalRef
    from oss.src.core.access.service import AccessService
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService
    from oss.tests.pytest.utils.memberships import (
        InMemoryMembershipsDAO,
        RecordingRbac,
    )
    from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO

    run, _ = exchange
    key = PrincipalRef(kind=PrincipalKind.HUMAN, id=USER_ID)
    principals = InMemoryPrincipalsDAO()
    principals.add(
        PrincipalRecord(principal=key, acting_user_id=USER_ID, is_active=False)
    )
    service = AccessService(
        memberships=MembershipsService(
            memberships_dao=InMemoryMembershipsDAO(),
            policy=MembershipPolicy.ORGANIZATION_WIDE,
        ),
        rbac=RecordingRbac(),
        principals=principals,
    )
    monkeypatch.setattr(access_router_module, "get_access_service", lambda: service)

    with pytest.raises(access_router_module.Deny):
        await run("run_service")

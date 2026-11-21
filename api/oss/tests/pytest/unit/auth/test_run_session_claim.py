"""The `run_session_id` claim (design D31): written at mint only through
`bind_run_session`, read by `run_session_id_of_request` only, carried unchanged by a
renewal at the exchange."""

from uuid import uuid4

import pytest
from jwt import decode, encode
from starlette.requests import Request

from oss.src.core.access.service import AccessService
from oss.src.core.sharing.admission import bind_run_session
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.middlewares import auth
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import (
    InMemoryPrincipalsDAO,
    envelope_for_claims,
    make_envelope,
)
from oss.tests.pytest.utils.sharing import SharingWorld

SECRET_KEY = "unit-test-secret-key-with-32-bytes"
U = "00000000-0000-4000-8000-0000000000a1"
P = "00000000-0000-4000-8000-0000000000b2"
O = "00000000-0000-4000-8000-0000000000c3"  # noqa: E741


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/tools/call",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture(autouse=True)
def signing_key(monkeypatch):
    monkeypatch.setattr(auth, "_SECRET_KEY", SECRET_KEY)


def _envelope():
    return envelope_for_claims(user_id=U, project_id=P, organization_id=O)


def _payload(token: str) -> dict:
    return decode(
        token, SECRET_KEY, algorithms=["HS256"], options={"verify_exp": False}
    )


# -- the claim ----------------------------------------------------------------------------


async def test_the_claim_survives_sign_and_verify():
    token = await auth.sign_secret_token(
        user_id=U,
        project_id=P,
        organization_id=O,
        envelope=_envelope(),
        run_session_id="sess-1",
    )
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    assert auth.run_session_id_of_request(request) == "sess-1"


async def test_a_credential_minted_before_the_claim_still_verifies():
    token = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=_envelope()
    )
    assert "run_session_id" not in _payload(token)
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=token)
    assert auth.run_session_id_of_request(request) is None
    assert auth.run_session_id_of_request(_request()) is None


@pytest.mark.parametrize("forged", [7, "", ["sess-1"]])
async def test_a_malformed_claim_refuses_the_credential(forged):
    token = await auth.sign_secret_token(
        user_id=U, project_id=P, organization_id=O, envelope=_envelope()
    )
    payload = _payload(token)
    payload["run_session_id"] = forged
    with pytest.raises(Exception):
        await auth.verify_secret_token(
            request=_request(),
            secret_token=encode(payload, SECRET_KEY, algorithm="HS256"),
        )


def test_the_reader_ignores_a_value_that_is_not_a_session_id():
    request = _request()
    request.state.run_session_id = 3
    assert auth.run_session_id_of_request(request) is None
    request.state.run_session_id = "sess-1"
    assert auth.run_session_id_of_request(request) == "sess-1"


# -- bind_run_session, over the real resource rules ----------------------------------


class _World:
    """A real `AccessService` over one project. Ana owns a private session and a
    project-visible one; Ben is another member."""

    def __init__(self) -> None:
        self.world = SharingWorld()
        self.ana = self.world.add_member(uuid4())
        self.ben = self.world.add_member(uuid4())
        principals = InMemoryPrincipalsDAO()
        for user in (self.ana, self.ben):
            principals.human(user)
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac_entitlement=RecordingRbac(),
            principals=principals,
            resource_policy=self.world.service,
        )
        self.private = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=self.ana)
        )
        self.shared = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=self.ana)
        )

    def envelope(self, user):
        return make_envelope(
            kind="human",
            principal_id=user,
            project_id=self.world.project_id,
            organization_id=self.world.organization_id,
        )


@pytest.fixture
def world(monkeypatch) -> _World:
    import oss.src.core.access.service as access_module

    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    return world


async def test_bind_names_a_session_the_run_authority_may_run(world):
    for session in (world.private, world.shared):
        assert (
            await bind_run_session(
                envelope=world.envelope(world.ana), session_id=session.session_id
            )
            == session.session_id
        )
    assert (
        await bind_run_session(
            envelope=world.envelope(world.ben), session_id=world.shared.session_id
        )
        == world.shared.session_id
    )


async def test_bind_refuses_another_members_private_session(world):
    assert (
        await bind_run_session(
            envelope=world.envelope(world.ben), session_id=world.private.session_id
        )
        is None
    )


async def test_bind_names_a_session_that_has_no_row_yet(world):
    """A first message: the session is created after the mint."""
    assert (
        await bind_run_session(envelope=world.envelope(world.ben), session_id="new-1")
        == "new-1"
    )


async def test_bind_looks_for_the_row_only_in_the_credentials_project(world):
    """A private session with this id in another project does not count: in Ben's
    project the id has no row, so his role decides, and the claim names an id that
    every session op reads in his project only."""
    world.world.dao.sessions[(uuid4(), "elsewhere-1")] = world.private.model_copy(
        update={"session_id": "elsewhere-1"}
    )
    assert (
        await bind_run_session(
            envelope=world.envelope(world.ben), session_id="elsewhere-1"
        )
        == "elsewhere-1"
    )


async def test_bind_refuses_a_deleted_private_session(world):
    world.world.dao.tombstones[(world.world.project_id, "gone-1")] = world.ana
    assert (
        await bind_run_session(envelope=world.envelope(world.ana), session_id="gone-1")
        is None
    )


@pytest.mark.parametrize("session_id", [None, "", "a/b", "x" * 129])
async def test_bind_names_no_session_for_an_id_the_store_refuses(world, session_id):
    assert (
        await bind_run_session(
            envelope=world.envelope(world.ana), session_id=session_id
        )
        is None
    )


# -- the permissions exchange ------------------------------------------------------------


async def _exchange(*, credential_kind, envelope, session_id, carried=None):
    from oss.src.apis.fastapi.access.router import AccessRouter
    from oss.src.core.access.context import reset_request_access, set_request_access
    from oss.tests.pytest.utils.principals import make_request_access

    request = _request()
    request.state.run_session_id = carried
    token = set_request_access(
        make_request_access(envelope=envelope, credential_kind=credential_kind)
    )
    try:
        return await AccessRouter()._run_session_id_of_exchange(
            request, envelope=envelope, session_id=session_id
        )
    finally:
        reset_request_access(token)


@pytest.mark.parametrize("credential_kind", ["bearer_session", "api_key"])
async def test_a_first_mint_binds_the_named_session(world, credential_kind):
    claim = await _exchange(
        credential_kind=credential_kind,
        envelope=world.envelope(world.ana),
        session_id=world.private.session_id,
    )
    assert claim == world.private.session_id


async def test_a_first_mint_for_another_members_private_session_has_no_claim(world):
    claim = await _exchange(
        credential_kind="bearer_session",
        envelope=world.envelope(world.ben),
        session_id=world.private.session_id,
    )
    assert claim is None


async def test_a_first_mint_without_a_session_has_no_claim(world):
    claim = await _exchange(
        credential_kind="api_key", envelope=world.envelope(world.ana), session_id=None
    )
    assert claim is None


async def test_a_renewal_carries_its_claim_and_ignores_the_named_session(world):
    claim = await _exchange(
        credential_kind="run_credential",
        envelope=world.envelope(world.ben),
        session_id=world.shared.session_id,
        carried="ben-own-1",
    )
    assert claim == "ben-own-1"


async def test_a_renewal_without_a_claim_never_gains_one(world):
    claim = await _exchange(
        credential_kind="run_credential",
        envelope=world.envelope(world.ana),
        session_id=world.private.session_id,
        carried=None,
    )
    assert claim is None


async def test_a_renewed_token_has_the_same_session_and_agent(world):
    """Sign, verify, then sign again the way the exchange renews: both claims stay."""
    from oss.src.core.access.context import reset_request_access, set_request_access
    from oss.src.middlewares.auth import _build_request_access_from_state

    envelope = world.envelope(world.ana)
    agent_id = uuid4()
    first = await auth.sign_secret_token(
        user_id=str(world.ana),
        project_id=str(world.world.project_id),
        organization_id=str(world.world.organization_id),
        envelope=envelope,
        run_agent_id=agent_id,
        run_session_id="child-1",
    )
    request = _request()
    await auth.verify_secret_token(request=request, secret_token=first)
    token = set_request_access(_build_request_access_from_state(request))
    try:
        from oss.src.apis.fastapi.access.router import AccessRouter

        router = AccessRouter()
        renewed = await auth.sign_secret_token(
            user_id=str(world.ana),
            project_id=str(world.world.project_id),
            organization_id=str(world.world.organization_id),
            envelope=envelope,
            run_agent_id=await router._run_agent_id_of_exchange(
                request, envelope=envelope, workflow_id=uuid4()
            ),
            run_session_id=await router._run_session_id_of_exchange(
                request, envelope=envelope, session_id="other-1"
            ),
        )
    finally:
        reset_request_access(token)
    claims = _payload(renewed)
    assert claims["run_session_id"] == "child-1"
    assert claims["run_agent_id"] == str(agent_id)

"""The cost of the session check on the runner write routes (rule S2), on records ingest.

The real `AccessService` with the real `SharingService` decides over Postgres; the
caches are the fake one with the real serializer (`FakeCache` counts its round trips);
the lock engine is a fake that counts the admission reads. Every count is of the second
call, with every cache warm.

- Runner path: the run the heartbeat admitted for the turn writes. The check is one
  lock round trip (`GETEX` of the admission record), no access decision, no Postgres.
- Full check (no admission record): no Postgres either; the session decision reads
  the session policy and the owner's membership from the cache.

Alice owns a private session; Bob is a member of the same project.
"""

from uuid import UUID, uuid4

import pytest
from fastapi import Request
from fastapi import HTTPException
from unittest.mock import AsyncMock
from uuid_utils.compat import uuid7

import oss.src.apis.fastapi.sessions.router as router_module
import oss.src.apis.fastapi.sharing.utils as sharing_utils
import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
import oss.src.dbs.postgres.access.dao as principals_module
from oss.src.apis.fastapi.sessions.models import SessionRecordIngestRequest
from oss.src.apis.fastapi.sessions.router import RecordsRouter
from oss.src.apis.fastapi.sharing.utils import check_resource, session_resource
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.service import SharingService
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.src.dbs.redis.sessions.locks import record_turn_admission
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration

TURN = str(uuid4())


class _Lock:
    """The admission keys of the lock engine, counting round trips."""

    def __init__(self) -> None:
        self.values: dict = {}
        self.round_trips = 0

    async def set(self, key, value, ex=None, **_):
        self.round_trips += 1
        self.values[key] = value
        return True

    async def getex(self, key, ex=None):
        self.round_trips += 1
        return self.values.get(key)


@pytest.fixture
def fake_cache(monkeypatch) -> FakeCache:
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    modules = [memberships_module, principals_module, sharing_module]
    if is_ee():
        import ee.src.core.access.entitlements.service as entitlements_module

        modules.append(entitlements_module)
    return FakeCache().install(monkeypatch, *modules)


@pytest.fixture
def lock(monkeypatch) -> _Lock:
    lock = _Lock()
    monkeypatch.setattr(sharing_utils, "get_lock_engine", lambda: lock)
    return lock


@pytest.fixture
async def seeded():
    organization = await seed_organization(members={"alice": "editor", "bob": "editor"})
    if is_ee():
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:o, 'cloud_v0_business', true)",
            {"o": organization.organization_id},
        )
    yield organization
    if is_ee():
        await execute(
            "DELETE FROM subscriptions WHERE organization_id = :o",
            {"o": organization.organization_id},
        )
    await delete_seeded_organization(organization)


@pytest.fixture
def access_service(monkeypatch) -> AccessService:
    """Built as `bootstrap_access` builds it, over Postgres."""

    engine = get_transactions_engine()
    if is_ee():
        from ee.src.core.access.rbac import EntitlementsRbacEnforcement

        rbac = EntitlementsRbacEnforcement()
        policy = MembershipPolicy.PROJECT_ROWS
    else:
        rbac = AlwaysEnforcedRbac()
        policy = MembershipPolicy.ORGANIZATION_WIDE
    memberships = MembershipsService(
        memberships_dao=MembershipsDAO(engine=engine), policy=policy
    )
    principals = PrincipalsDAO(engine=engine)
    service = AccessService(
        memberships=memberships,
        rbac=rbac,
        principals=principals,
        resource_policy=SharingService(
            sharing_dao=SharingDAO(engine=engine),
            memberships_service=memberships,
            principals_dao=principals,
        ),
    )
    monkeypatch.setattr(access_module, "_access_service", service)
    monkeypatch.setattr(router_module, "publish_record", AsyncMock(return_value=True))
    return service


async def _private_session(project_id: UUID, owner: UUID) -> str:
    stream_id = uuid7()
    session_id = f"runner-write-{stream_id.hex}"
    await execute(
        "INSERT INTO session_streams (project_id, id, session_id, visibility, "
        "owner_user_id) VALUES (:p, :id, :s, 'private', :o)",
        {"p": project_id, "id": stream_id, "s": session_id, "o": owner},
    )
    return session_id


def _access(seeded, user_id: UUID) -> RequestAccess:
    """The run credential (Secret) of a web turn of `user_id`."""

    principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)
    authority = RunAuthority(
        principal=principal,
        organization_id=seeded.organization_id,
        project_id=seeded.project_ids[0],
    )
    return RequestAccess(
        principal=principal,
        authority=authority,
        credential_kind=RequestCredentialKind.RUN_CREDENTIAL,
        acting_user_id=user_id,
        envelope=RunEnvelope(
            authority=authority,
            context=RunContext(origin=RunOrigin.WEB, run_id=TURN),
            sender=RunSender(user_id=user_id),
        ),
    )


def _request(seeded, access: RequestAccess) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    state = request.state
    state.project_id = str(seeded.project_ids[0])
    state.user_id = str(access.acting_user_id)
    state.organization_id = str(seeded.organization_id)
    state.principal = access.principal
    state.authority = access.authority
    state.credential_kind = access.credential_kind
    state.run_envelope = access.envelope
    return request


def _record(session_id: str) -> SessionRecordIngestRequest:
    return SessionRecordIngestRequest(
        session_id=session_id,
        record_type="message",
        attributes={"text": "hello"},
        turn_id=TURN,
    )


async def _ingest(seeded, access, session_id):
    """One request: its own request access and memo, as the auth middleware sets."""

    token = set_request_access(access)
    try:
        return await RecordsRouter(records_service=AsyncMock()).ingest_record_event(
            request=_request(seeded, access), body=_record(session_id)
        )
    finally:
        reset_request_access(token)


async def _measured(seeded, access, session_id, fake_cache, lock):
    await _ingest(seeded, access, session_id)  # warms every cache
    cache_before, lock_before = fake_cache.read_round_trips, lock.round_trips
    with count_statements(get_transactions_engine()) as statements:
        answer = await _ingest(seeded, access, session_id)
    return (
        answer,
        statements,
        fake_cache.read_round_trips - cache_before,
        lock.round_trips - lock_before,
    )


async def _capability_round_trips(seeded, access, fake_cache) -> int:
    """The cache round trips of the route's capability check alone (warm)."""

    from oss.src.core.access.permissions.service import check_action_access

    async def _check():
        token = set_request_access(access)
        try:
            await check_action_access(
                user_uid=str(access.acting_user_id),
                project_id=str(seeded.project_ids[0]),
                permission=Permission.RUN_SESSIONS,
            )
        finally:
            reset_request_access(token)

    await _check()
    before = fake_cache.read_round_trips
    await _check()
    return fake_cache.read_round_trips - before


async def test_admitted_runner_ingest_is_one_redis_read_and_no_statement(
    seeded, fake_cache, lock, access_service
):
    alice = seeded.user_ids["alice"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    access = _access(seeded, alice)
    await record_turn_admission(
        lock,
        project_id=str(project_id),
        session_id=session_id,
        turn_id=TURN,
        principal=access.principal,
    )
    capability = await _capability_round_trips(seeded, access, fake_cache)

    answer, statements, cache_round_trips, lock_round_trips = await _measured(
        seeded, access, session_id, fake_cache, lock
    )

    assert answer == {"ok": True}
    assert statements == []
    # The session check adds no cache read and no decision: one GETEX only.
    assert cache_round_trips == capability
    assert lock_round_trips == 1


async def test_full_check_ingest_reads_no_statement_when_warm(
    seeded, fake_cache, lock, access_service
):
    """No admission record (a lost record, a Redis restart): the full check runs, with
    every read warm in the cache."""

    alice = seeded.user_ids["alice"]
    session_id = await _private_session(seeded.project_ids[0], alice)
    access = _access(seeded, alice)
    capability = await _capability_round_trips(seeded, access, fake_cache)

    answer, statements, cache_round_trips, lock_round_trips = await _measured(
        seeded, access, session_id, fake_cache, lock
    )

    assert answer == {"ok": True}
    assert statements == []
    # The session policy and the owner's membership: two cache reads beyond the
    # capability check, plus the admission read that missed.
    assert cache_round_trips - capability == 2
    assert lock_round_trips == 1


async def test_plain_check_resource_cost_when_warm(seeded, fake_cache, access_service):
    """The option without the continuity path: `check_resource(RUN_SESSIONS)` on every
    write. No statement when warm, two cache round trips per write."""

    alice = seeded.user_ids["alice"]
    session_id = await _private_session(seeded.project_ids[0], alice)
    access = _access(seeded, alice)

    async def _check():
        token = set_request_access(access)
        try:
            await check_action_access_and_resource()
        finally:
            reset_request_access(token)

    async def check_action_access_and_resource():
        from oss.src.core.access.permissions.service import check_action_access

        await check_action_access(
            user_uid=str(alice),
            project_id=str(seeded.project_ids[0]),
            permission=Permission.RUN_SESSIONS,
        )
        await check_resource(
            _request(seeded, access),
            action=Permission.RUN_SESSIONS,
            resource=session_resource(session_id),
        )

    await _check()
    capability = await _capability_round_trips(seeded, access, fake_cache)
    before = fake_cache.read_round_trips
    with count_statements(get_transactions_engine()) as statements:
        await _check()

    assert statements == []
    assert fake_cache.read_round_trips - before - capability == 2


async def test_bob_is_refused_with_the_not_found_body(
    seeded, fake_cache, lock, access_service
):
    alice = seeded.user_ids["alice"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    await record_turn_admission(
        lock,
        project_id=str(project_id),
        session_id=session_id,
        turn_id=TURN,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=alice),
    )

    with pytest.raises(HTTPException) as refused:
        await _ingest(seeded, _access(seeded, seeded.user_ids["bob"]), session_id)

    assert refused.value.status_code == 404
    assert refused.value.detail == sharing_utils.NOT_FOUND_ERROR.model_dump(
        exclude_none=True
    )

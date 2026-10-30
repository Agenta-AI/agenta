"""The cost of the session check on the runner write routes (rule S2), on records ingest.

The real `AccessService` with the real `SharingService` decides over Postgres; the
caches are the fake one with the real serializer (`FakeCache` counts its round trips);
the lock engine is a fake that counts the admission reads. Every count is of the second
call, with every cache warm.

- Runner path: the run the heartbeat admitted for the session's current turn writes.
  The check is one lock round trip (the script that reads the admission record only
  while its turn holds `running`, and renews it), no access decision, no Postgres.
- Full check (no admission record, or a record of a turn that is not the current one):
  no Postgres either; the session decision reads the session policy and the owner's
  membership from the cache.

The lock engine is a real Redis, so the real lock script runs. The stack's Redis is
not published to the host: run these tests with a throwaway one, for example

    docker run -d --rm --name m3-counts-redis -p 127.0.0.1:6391:6379 redis:8
    REDIS_URI_VOLATILE=redis://127.0.0.1:6391/0 REDIS_URI_DURABLE=redis://127.0.0.1:6391/1 \
        uv run --no-sync python run-tests.py --env-file <stack env> <this file>

Without a reachable Redis every test that needs the lock engine skips, with the reason.

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
from oss.src.core.access.rbac import NoRbacEntitlement
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.sharing.service import SharingService
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.sharing.dao import SharingDAO
from oss.src.dbs.redis.sessions.contract import running_key
from oss.src.dbs.redis.sessions.locks import TurnAdmission, record_turn_admission
from oss.src.dbs.redis.shared.engine import get_lock_engine
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
    """The real lock engine, counting the commands it sends to Redis."""

    def __init__(self, engine) -> None:
        self.engine = engine
        self.round_trips = 0
        client = engine._client()
        original = client.execute_command

        async def execute_command(*args, **options):
            self.round_trips += 1
            return await original(*args, **options)

        client.execute_command = execute_command

    def __getattr__(self, name):
        return getattr(self.engine, name)


@pytest.fixture(autouse=True)
def _entitlements(monkeypatch):
    """As `ee/src/main.py` does at startup. Without it the plan read raises and
    `check_entitlements` fails open, so the RBAC entitlement is never read."""

    if not is_ee():
        return
    import ee.src.core.access.entitlements.service as entitlements_module

    for name in ("_meters_service_singleton", "_subscriptions_service_singleton"):
        monkeypatch.setattr(
            entitlements_module, name, getattr(entitlements_module, name)
        )
    entitlements_module.bootstrap_entitlements_services()


@pytest.fixture
def fake_cache(monkeypatch) -> FakeCache:
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    modules = [memberships_module, principals_module, sharing_module]
    if is_ee():
        import ee.src.core.access.entitlements.service as entitlements_module

        modules.append(entitlements_module)
    return FakeCache().install(monkeypatch, *modules)


@pytest.fixture
async def lock(monkeypatch, fake_cache):
    """The real lock engine on a real Redis, or a skip with the reason. The fake cache
    reads a raw entry (a runner write's admission keys, in the request's one cache read)
    from the same Redis, on its own client: those reads count as the cache's round trip,
    as they are one `MGET` with the cache entries in production."""

    from redis.asyncio import Redis

    uri = env.redis.uri_volatile
    probe = Redis.from_url(uri, socket_connect_timeout=0.5, socket_timeout=0.5)
    try:
        await probe.ping()
    except Exception as error:  # pylint: disable=broad-exception-caught
        pytest.skip(
            f"no Redis reachable at REDIS_URI_VOLATILE={uri} "
            f"({type(error).__name__}); the lock script needs a real Redis. Start a "
            "throwaway one (docker run -d --rm --name m3-counts-redis -p "
            "127.0.0.1:6391:6379 redis:8) and set "
            "REDIS_URI_VOLATILE=redis://127.0.0.1:6391/0."
        )
    finally:
        await probe.aclose()

    engine = get_lock_engine()
    # The client binds to the event loop that opens it: each test opens its own. A
    # client of an earlier test's (closed) loop cannot be closed here: it is dropped.
    try:
        await engine.close()
    except RuntimeError:
        engine._r = None
    lock = _Lock(engine)
    monkeypatch.setattr(sharing_utils, "get_lock_engine", lambda: lock)
    reader = Redis.from_url(uri)
    fake_cache.raw_reader = reader.mget
    yield lock
    await reader.aclose()
    await engine.close()


async def _admit(
    lock, *, project_id, session_id, principal, turn_id=TURN, current=True
):
    """The heartbeat admitted `principal`'s run for `turn_id`; with `current`, that turn
    holds the session's `running` lock."""

    await record_turn_admission(
        lock,
        project_id=str(project_id),
        session_id=session_id,
        turn_id=turn_id,
        admission=TurnAdmission(principal=principal, origin="web"),
    )
    if current:
        await lock.set(running_key(str(project_id), session_id), turn_id.encode())


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
        from ee.src.core.access.rbac import PlanRbacEntitlement

        rbac = PlanRbacEntitlement()
        policy = MembershipPolicy.PROJECT_ROWS
    else:
        rbac = NoRbacEntitlement()
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


def _record(session_id: str, turn_id: str = TURN) -> SessionRecordIngestRequest:
    return SessionRecordIngestRequest(
        session_id=session_id,
        record_type="message",
        attributes={"text": "hello"},
        turn_id=turn_id,
    )


async def _ingest(seeded, access, session_id, turn_id: str = TURN):
    """One request: its own request access and memo, as the auth middleware sets."""

    token = set_request_access(access)
    try:
        return await RecordsRouter(records_service=AsyncMock()).ingest_record_event(
            request=_request(seeded, access), body=_record(session_id, turn_id)
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
    await _admit(
        lock,
        project_id=project_id,
        session_id=session_id,
        principal=access.principal,
    )
    capability = await _capability_round_trips(seeded, access, fake_cache)

    answer, statements, cache_round_trips, lock_round_trips = await _measured(
        seeded, access, session_id, fake_cache, lock
    )

    assert answer == {"ok": True}
    assert statements == []
    # The session check adds no round trip and no decision: the admission keys ride in
    # the capability check's one cache read, and no lock script runs.
    assert cache_round_trips == capability
    assert lock_round_trips == 0


async def test_old_turn_replay_after_grant_removal_is_refused(
    seeded, fake_cache, lock, access_service
):
    """Bob was admitted for an old turn while he held a participant grant; the grant is
    gone and Alice's turn is the current one. His old turn's record survives, but a
    write that names the old turn takes the full check and is refused (hidden)."""

    alice = seeded.user_ids["alice"]
    bob = seeded.user_ids["bob"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    old_turn = str(uuid4())
    await _admit(
        lock,
        project_id=project_id,
        session_id=session_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=bob),
        turn_id=old_turn,
        current=False,
    )
    await _admit(
        lock,
        project_id=project_id,
        session_id=session_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=alice),
    )

    with pytest.raises(HTTPException) as refused:
        await _ingest(seeded, _access(seeded, bob), session_id, turn_id=old_turn)

    assert refused.value.status_code == 404


async def test_full_check_ingest_reads_no_statement_when_warm(
    seeded, fake_cache, lock, access_service
):
    """No admission record (a lost record, a Redis restart): the full check runs, with
    every read warm in the cache, and no round trip beyond the capability check."""

    alice = seeded.user_ids["alice"]
    session_id = await _private_session(seeded.project_ids[0], alice)
    access = _access(seeded, alice)
    capability = await _capability_round_trips(seeded, access, fake_cache)

    answer, statements, cache_round_trips, lock_round_trips = await _measured(
        seeded, access, session_id, fake_cache, lock
    )

    assert answer == {"ok": True}
    assert statements == []
    # The session entry and the admission keys ride in the capability check's one
    # cache read (the owner is the caller: its membership is in that read too).
    assert cache_round_trips - capability == 0
    assert lock_round_trips == 0


async def test_plain_check_resource_cost_when_warm(seeded, fake_cache, access_service):
    """The option without the continuity path: `check_resource(RUN_SESSIONS)` on every
    write. No statement when warm, one cache round trip per write beyond the capability
    check (the session entry and the owner's membership, read in one MGET; the owner is the
    caller, so the membership is the one the capability check read)."""

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
    assert fake_cache.read_round_trips - before - capability == 1


async def test_bob_is_refused_with_the_not_found_body(
    seeded, fake_cache, lock, access_service
):
    alice = seeded.user_ids["alice"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    await _admit(
        lock,
        project_id=project_id,
        session_id=session_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=alice),
    )

    with pytest.raises(HTTPException) as refused:
        await _ingest(seeded, _access(seeded, seeded.user_ids["bob"]), session_id)

    assert refused.value.status_code == 404
    assert refused.value.detail == sharing_utils.NOT_FOUND_ERROR.model_dump(
        exclude_none=True
    )


def _frame(session_id: str, turn_id: str = TURN, index: int = 0):
    from datetime import datetime, timezone  # noqa: PLC0415

    return SessionRecordIngestRequest(
        version=1,
        kind="frame",
        session_id=session_id,
        execution_id=turn_id,
        frame_or_event_id=f"{turn_id}:{index}",
        frame_index=index,
        entity_id="m1",
        type="text-delta",
        payload={"id": "m1", "delta": "partial"},
        created_at=datetime.now(timezone.utc),
    )


async def _measured_frame(seeded, access, session_id, fake_cache, lock):
    """One warm frame request: its answer (or refusal status) and its costs."""

    async def _once():
        token = set_request_access(access)
        try:
            return await RecordsRouter(records_service=AsyncMock()).ingest_record_event(
                request=_request(seeded, access), body=_frame(session_id)
            )
        except HTTPException as error:
            return error.status_code
        finally:
            reset_request_access(token)

    await _once()  # warms every cache
    cache_before, lock_before = fake_cache.read_round_trips, lock.round_trips
    with count_statements(get_transactions_engine()) as statements:
        answer = await _once()
    return (
        answer,
        statements,
        fake_cache.read_round_trips - cache_before,
        lock.round_trips - lock_before,
    )


async def test_a_frame_after_stop_answers_409_at_the_cost_of_a_running_frame(
    seeded, fake_cache, lock, access_service, monkeypatch
):
    """A Stop (or a newer turn) moved the session's running turn while the runner still
    streams. The turn's next frame answers 409 (not 403, which the runner reads as lost
    access), publishes nothing, and costs no statement and no round trip more than a
    frame of the running turn. Bob, who cannot see the session, keeps his 403."""

    monkeypatch.setattr(router_module, "get_lock_engine", lambda: lock)
    publish = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "publish_live_frame", publish)
    alice = seeded.user_ids["alice"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    access = _access(seeded, alice)
    await _admit(
        lock, project_id=project_id, session_id=session_id, principal=access.principal
    )

    running = await _measured_frame(seeded, access, session_id, fake_cache, lock)
    assert running[0] == {"ok": True}
    published = publish.await_count

    # The Stop: the turn no longer holds `running`.
    await lock.delete(running_key(str(project_id), session_id))
    stopped = await _measured_frame(seeded, access, session_id, fake_cache, lock)
    # A newer turn holds `running`.
    await lock.set(running_key(str(project_id), session_id), str(uuid4()).encode())
    superseded = await _measured_frame(seeded, access, session_id, fake_cache, lock)

    for answer in (stopped, superseded):
        assert answer[0] == 409
        assert answer[1] == []
        assert answer[2] <= running[2]
        assert answer[3] <= running[3]
    assert running[1] == []
    assert publish.await_count == published

    bob = await _measured_frame(
        seeded, _access(seeded, seeded.user_ids["bob"]), session_id, fake_cache, lock
    )
    assert bob[0] == 403
    assert bob[1] == []
    assert publish.await_count == published


async def test_an_old_admission_never_turns_a_hidden_frame_into_409(
    seeded, fake_cache, lock, access_service, monkeypatch
):
    """Bob's runner was admitted for an old turn while he could run the session; he can
    no longer see it, and his turn is not the running one. His frame takes the full
    check, not his old admission: 403, which ends his turn as access denied."""

    monkeypatch.setattr(router_module, "get_lock_engine", lambda: lock)
    publish = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "publish_live_frame", publish)
    alice = seeded.user_ids["alice"]
    bob = seeded.user_ids["bob"]
    project_id = seeded.project_ids[0]
    session_id = await _private_session(project_id, alice)
    await _admit(
        lock,
        project_id=project_id,
        session_id=session_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=bob),
        current=False,
    )

    answer = await _measured_frame(
        seeded, _access(seeded, bob), session_id, fake_cache, lock
    )

    assert answer[0] == 403
    publish.assert_not_awaited()

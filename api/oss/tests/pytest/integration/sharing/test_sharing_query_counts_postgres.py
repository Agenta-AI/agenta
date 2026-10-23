"""Statement counts of the sharing hot paths (M3 latency gate).

Each "After" value of the plan's latency table is pinned here. Every count is the total
number of statements the measured call sends through `get_transactions_engine()`
(M1's `count_statements`: what reaches the cursor, so `BEGIN`, `COMMIT` and the pool
pre-ping are not counted), with every cache warm: each case makes the call once with
the same shape, then counts the next call.

The services are built as `entrypoints/routers.py` builds them: `bootstrap_access()`
(the real `AccessService` with the real `SharingService` as its resource policy; under
EE the real `EntitlementsRbacEnforcement`, on an organization whose plan has the RBAC
entitlement), the real DAOs on the transactions engine, the real `LockEngine` and the
real `RunAdmission`. Every cache and lock is a real Redis, so the real serializer and
the real lock scripts run. The stack's Redis is not published to the host: run these
tests with a throwaway one, for example

    docker run -d --rm --name m3-counts-redis -p 127.0.0.1:6391:6379 redis:8
    REDIS_URI_VOLATILE=redis://127.0.0.1:6391/0 REDIS_URI_DURABLE=redis://127.0.0.1:6391/1 \
        uv run --no-sync python run-tests.py --env-file <stack env> <this file>

Without a reachable Redis every test skips, with the reason.

"Before" is the M2 top, measured in M3 Task 0 with the same method (OSS and EE gave the
same numbers). A count that fails is a latency blocker: fix the code path, do not
loosen the test.

The cost of the session check on the runner write routes (records, interactions,
turns) is pinned in `test_runner_write_counts_postgres.py`: 0 Postgres statements
warm on the admitted path, one Redis script (`EVAL` of the current turn admission).
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
import oss.src.models.db_models  # noqa: F401  (the mapper registry, as the app has it)
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, ResourceKind
from oss.src.core.access.dtos import ResourceRef
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.sessions.commands.delivery import deliver_continue_input
from oss.src.core.sessions.commands.dtos import (
    SessionCommand,
    SessionCommandKind,
    SessionCommandState,
)
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStreamCommandRequest,
    SessionStreamQuery,
    SessionStreamQueryFlags,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.turns.service import SessionTurnsService
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sharing.admission import RunAdmission
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    Visibility,
)
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.workflows.dtos import WorkflowRevisionCommit, WorkflowRevisionData
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.turns.dao import SessionTurnsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.workflows.dao import WorkflowsDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.dbs.redis.sessions.contract import turn_admitted_key
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher
from oss.src.dbs.redis.shared.engine import get_lock_engine
from oss.src.utils import caching
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.apis.fastapi.sessions.models import SessionQueryRequest
from oss.src.apis.fastapi.sessions.utils import normalize_session_query_request
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.principals import (
    AllowingAccessService,
    make_envelope,
    make_request_access,
)
from oss.tests.pytest.utils.sharing import NoopRunAdmission
from oss.tests.pytest.utils.statements import (
    count_statements,
    count_statements_by_phase,
    patch_access_phase,
)


pytestmark = pytest.mark.integration


# M2 top (M3 Task 0, ~/agenta-m3-qa/before/query-counts.json): the same in OSS and EE.
HB_STEADY = 2
HB_FIRST = 4
HB_CREATE = 3
SEND = 3
SQ = 2
SSQ = 1
WQ = 1
WVQ = 2
WRQ = 3


# -- Redis -----------------------------------------------------------------------------


class RedisCommands:
    """Records every command the cache and lock clients send to Redis while
    `recording` is set (both clients wrap the real one)."""

    def __init__(self) -> None:
        self.commands: List[tuple] = []
        self.recording = False

    def install(self, engine) -> None:
        client = engine._client()
        original = client.execute_command

        async def execute_command(*args, **options):
            if self.recording:
                self.commands.append(tuple(args))
            return await original(*args, **options)

        client.execute_command = execute_command

    def named(self, name: str) -> List[tuple]:
        return [c for c in self.commands if str(c[0]).upper() == name.upper()]

    def touching(self, fragment: bytes) -> List[tuple]:
        def _raw(value) -> bytes:
            return value if isinstance(value, bytes) else str(value).encode()

        return [c for c in self.commands if any(fragment in _raw(a) for a in c)]


async def _close_redis_clients() -> None:
    await caching._cache_engine.close()
    await get_lock_engine().close()


@pytest.fixture
async def redis_commands(monkeypatch) -> RedisCommands:
    """A real Redis for every cache and lock, or a skip with the reason."""

    from redis.asyncio import Redis

    uri = env.redis.uri_volatile
    probe = Redis.from_url(uri, socket_connect_timeout=0.5, socket_timeout=0.5)
    try:
        await probe.ping()
    except Exception as error:  # pylint: disable=broad-exception-caught
        pytest.skip(
            f"no Redis reachable at REDIS_URI_VOLATILE={uri} "
            f"({type(error).__name__}); the counts need a real Redis. Start a "
            "throwaway one (docker run -d --rm --name m3-counts-redis -p "
            "127.0.0.1:6391:6379 redis:8) and set "
            "REDIS_URI_VOLATILE=redis://127.0.0.1:6391/0."
        )
    finally:
        await probe.aclose()

    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    # The clients bind to the event loop that opens them: each test opens its own.
    await _close_redis_clients()
    commands = RedisCommands()
    commands.install(caching._cache_engine)
    commands.install(get_lock_engine())
    yield commands
    await _close_redis_clients()


# -- the world ---------------------------------------------------------------------------


@dataclass
class World:
    organization_id: UUID
    project_id: UUID
    alice: UUID
    bob: UUID
    viewer: UUID
    access: AccessService
    streams: SessionStreamsService
    sessions: SessionsService
    workflows: WorkflowsService
    admission: RunAdmission
    shared_agent: UUID
    private_agent: UUID
    # The beat references of each agent (artifact, variant, revision).
    refs: Dict[UUID, List[SessionReference]]

    def envelope(self, user_id: UUID):
        return make_envelope(
            kind="human",
            principal_id=user_id,
            origin="web",
            project_id=self.project_id,
            organization_id=self.organization_id,
        )

    def private_policy(self, user_id: UUID) -> AccessPolicy:
        return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=user_id)


async def _seed_agent(
    workflows: WorkflowsService,
    *,
    project_id: UUID,
    user_id: UUID,
    owner: Optional[UUID],
):
    """An agent (artifact, variant, one committed revision). With `owner`, a private
    `agent_access` row; without, no row (project-visible, ownerless)."""

    artifact_id, variant_id = uuid4(), uuid4()
    await execute(
        "INSERT INTO workflow_artifacts (id, project_id, slug, created_at) "
        "VALUES (:id, :p, :slug, now())",
        {"id": artifact_id, "p": project_id, "slug": f"m3cnt-{artifact_id.hex[:8]}"},
    )
    await execute(
        "INSERT INTO workflow_variants (id, project_id, artifact_id, slug, created_at) "
        "VALUES (:id, :p, :a, :slug, now())",
        {
            "id": variant_id,
            "p": project_id,
            "a": artifact_id,
            "slug": f"m3cnt-v-{variant_id.hex[:8]}",
        },
    )
    outcome = await workflows.commit_workflow_revision_checked(
        project_id=project_id,
        user_id=user_id,
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_variant_id=variant_id,
            data=WorkflowRevisionData(url="http://services/agent"),
            message="seed",
        ),
    )
    assert outcome.status == "committed", outcome
    if owner is not None:
        await execute(
            "INSERT INTO agent_access (project_id, artifact_id, visibility, "
            "owner_user_id) VALUES (:p, :a, 'private', :o)",
            {"p": project_id, "a": artifact_id, "o": owner},
        )
    return artifact_id, [
        SessionReference(key="workflow", id=artifact_id),
        SessionReference(key="workflow_variant", id=variant_id),
        SessionReference(key="workflow_revision", id=outcome.revision.id),
    ]


async def _assert_rbac_is_enforced(world: World) -> None:
    """EE: the plan's RBAC entitlement is read for real (not the fail-open answer of
    `check_entitlements`) and enforces roles: a viewer may not edit."""

    from ee.src.core.access.entitlements.service import (
        Flag,
        _check_entitlements,
        scope_from,
    )

    check, _, _ = await _check_entitlements(
        key=Flag.RBAC,
        delta=None,
        cache=False,
        scope=scope_from(organization_id=world.organization_id),
        period=None,
    )
    assert check is True
    decision = await world.access.decide(
        authority=None,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.viewer),
        action=Permission.EDIT_WORKFLOWS,
        project_id=world.project_id,
    )
    assert not decision.allowed


@pytest.fixture
async def world(redis_commands, monkeypatch) -> World:
    from entrypoints.access import bootstrap_access

    # bootstrap_access registers process services: restore them after the test.
    monkeypatch.setattr(access_module, "_access_service", access_module._access_service)
    monkeypatch.setattr(
        sharing_module, "_sharing_service", sharing_module._sharing_service
    )
    monkeypatch.setattr(
        memberships_module,
        "_memberships_service",
        memberships_module._memberships_service,
    )
    patch_access_phase(monkeypatch)
    if is_ee():
        # As `ee/src/main.py` does at startup. Without it the plan read raises and
        # `check_entitlements` fails open, so the RBAC entitlement is never read.
        import ee.src.core.access.entitlements.service as entitlements_module

        for name in ("_meters_service_singleton", "_subscriptions_service_singleton"):
            monkeypatch.setattr(
                entitlements_module, name, getattr(entitlements_module, name)
            )
        entitlements_module.bootstrap_entitlements_services()
    access_service = bootstrap_access()
    if is_ee():
        from ee.src.core.access.rbac import EntitlementsRbacEnforcement

        assert isinstance(access_service._rbac, EntitlementsRbacEnforcement)

    engine = get_transactions_engine()
    lock_engine = get_lock_engine()
    publisher = SessionsWatchPublisher()
    streams = SessionStreamsService(
        streams_dao=SessionStreamsDAO(engine=engine),
        lock_engine=lock_engine,
        watch_publisher=publisher,
    )
    # Interactions, mounts and records are not on the `{}` list path.
    sessions = SessionsService(
        streams_service=streams,
        turns_service=SessionTurnsService(turns_dao=SessionTurnsDAO(engine=engine)),
        interactions_service=None,
        mounts_service=None,
        records_service=None,
    )
    workflows = WorkflowsService(
        workflows_dao=WorkflowsDAO(
            engine=engine,
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
        ),
        static_catalog=StaticWorkflowCatalog(),
        watch_publisher=publisher,
    )

    seeded = await seed_organization(
        members={"alice": "editor", "bob": "editor", "viewer": "viewer"}
    )
    if is_ee():
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:o, 'cloud_v0_business', true)",
            {"o": seeded.organization_id},
        )
    project_id = seeded.project_ids[0]
    alice = seeded.user_ids["alice"]
    try:
        shared_agent, shared_refs = await _seed_agent(
            workflows, project_id=project_id, user_id=alice, owner=None
        )
        private_agent, private_refs = await _seed_agent(
            workflows, project_id=project_id, user_id=alice, owner=alice
        )
        built = World(
            organization_id=seeded.organization_id,
            project_id=project_id,
            alice=alice,
            bob=seeded.user_ids["bob"],
            viewer=seeded.user_ids["viewer"],
            access=access_service,
            streams=streams,
            sessions=sessions,
            workflows=workflows,
            admission=RunAdmission(
                access_service=access_service, workflows_service=workflows
            ),
            shared_agent=shared_agent,
            private_agent=private_agent,
            refs={shared_agent: shared_refs, private_agent: private_refs},
        )
        if is_ee():
            await _assert_rbac_is_enforced(built)
        yield built
    finally:
        for table in (
            "trigger_deliveries",
            "trigger_schedules",
            "session_turns",
            "session_streams",
            "workflow_revisions",
            "workflow_variants",
            "workflow_artifacts",
        ):
            await execute(
                f"DELETE FROM {table} WHERE project_id = :p", {"p": project_id}
            )
        if is_ee():
            await execute(
                "DELETE FROM subscriptions WHERE organization_id = :o",
                {"o": seeded.organization_id},
            )
        await delete_seeded_organization(seeded)


@pytest.fixture
def decide_calls(monkeypatch) -> List[dict]:
    """Every `AccessService.decide` call, in order."""

    calls: List[dict] = []
    original = AccessService.decide

    async def decide(self, **kwargs):
        calls.append(kwargs)
        return await original(self, **kwargs)

    monkeypatch.setattr(AccessService, "decide", decide)
    return calls


# -- heartbeats --------------------------------------------------------------------------


def _sid() -> str:
    return str(uuid4())


def _beat(
    world: World,
    session_id: str,
    turn_id: Optional[str],
    *,
    user_id: Optional[UUID] = None,
    running: bool = True,
    references: Optional[List[SessionReference]] = None,
    admission=None,
    access: Optional[AccessPolicy] = None,
):
    """One beat with the run credential (Secret) of `user_id`'s web turn (Alice by
    default), as the heartbeat route passes it. A beat that creates the row writes
    `access` (default: private, owned by `user_id`)."""

    envelope = world.envelope(user_id or world.alice)
    return world.streams.heartbeat(
        project_id=world.project_id,
        request=SessionHeartbeatRequest(
            session_id=session_id,
            replica_id="m3-counts",
            turn_id=turn_id,
            is_running=running,
            references=references,
        ),
        runner_verified=False,
        envelope=envelope,
        access=access or world.private_policy(user_id or world.alice),
        run_admission=admission or world.admission,
        admission_envelope=envelope,
    )


async def _steady_beat_statements(world: World, admission) -> List[str]:
    """The third running beat of one turn (the row holds the references, the beat
    proposes them again)."""

    refs = world.refs[world.shared_agent]
    session_id, turn = _sid(), str(uuid4())
    await _beat(world, session_id, turn, references=refs, admission=admission)
    result = await _beat(world, session_id, turn, references=refs, admission=admission)
    assert result.is_current_turn
    with count_statements(get_transactions_engine()) as statements:
        result = await _beat(
            world, session_id, turn, references=refs, admission=admission
        )
    assert result.is_current_turn
    return statements


async def test_steady_beat_adds_no_statement(world, decide_calls):
    noop = await _steady_beat_statements(world, NoopRunAdmission())

    decide_calls.clear()
    refs = world.refs[world.shared_agent]
    session_id, turn = _sid(), str(uuid4())
    await _beat(world, session_id, turn, references=refs)  # creates, admits
    await _beat(world, session_id, turn, references=refs)  # warm steady
    decide_calls.clear()
    with count_statements(get_transactions_engine()) as statements:
        result = await _beat(world, session_id, turn, references=refs)

    assert result.is_current_turn
    assert len(statements) == HB_STEADY
    assert len(statements) == len(noop)
    assert decide_calls == []


async def test_steady_beats_read_no_sharing_cache_key(world, redis_commands):
    """20 steady beats of the admitted run: no `sharing_*` cache key is read, and each
    beat reads (and renews) the admission record once."""

    refs = world.refs[world.shared_agent]
    session_id, turn = _sid(), str(uuid4())
    await _beat(world, session_id, turn, references=refs)
    await _beat(world, session_id, turn, references=refs)

    redis_commands.commands.clear()
    redis_commands.recording = True
    try:
        for _ in range(20):
            assert (
                await _beat(world, session_id, turn, references=refs)
            ).is_current_turn
    finally:
        redis_commands.recording = False

    assert redis_commands.commands, "the beats must have reached Redis"
    assert redis_commands.touching(b"sharing_") == []
    admission_key = turn_admitted_key(str(world.project_id), session_id, turn)
    reads = [c for c in redis_commands.named("EVAL") if admission_key in str(c[1:])]
    assert len(reads) == 20


async def _first_beat_statements(
    world: World,
    *,
    references: Optional[List[SessionReference]],
    admission=None,
) -> List[str]:
    """The first running beat of a new turn on an existing row: the previous turn
    ended, `alive` is still held by it (handover branch)."""

    session_id, previous = _sid(), str(uuid4())
    await _beat(world, session_id, previous, references=references, admission=admission)
    await _beat(
        world,
        session_id,
        previous,
        running=False,
        references=references,
        admission=admission,
    )
    turn = str(uuid4())
    assert (
        await _beat(world, session_id, turn, references=references, admission=admission)
    ).is_current_turn  # warm: first beat of turn 2
    await _beat(
        world,
        session_id,
        turn,
        running=False,
        references=references,
        admission=admission,
    )
    with count_statements(get_transactions_engine()) as statements:
        result = await _beat(
            world, session_id, str(uuid4()), references=references, admission=admission
        )
    assert result.is_current_turn
    return statements


async def test_checked_beat_draft_adds_no_statement(world, decide_calls):
    # The first beat of a turn, no agent reference: checked (the session decision),
    # warm, it reads Redis only.
    decide_calls.clear()
    statements = await _first_beat_statements(world, references=None)
    assert len(statements) == HB_FIRST
    assert decide_calls, "the first beat of a turn is checked"

    # A beat without a turn id on an existing row: checked too (no continuity without
    # a turn), and it costs what it cost before admission (a no-op admission runs the
    # M2 code path).
    async def _no_turn_beat(admission):
        session_id, turn = _sid(), str(uuid4())
        await _beat(world, session_id, turn, admission=admission)
        await _beat(world, session_id, turn, running=False, admission=admission)
        await _beat(world, session_id, None, running=False, admission=admission)
        decide_calls.clear()
        with count_statements(get_transactions_engine()) as statements:
            await _beat(world, session_id, None, running=False, admission=admission)
        return statements, list(decide_calls)

    noop, _ = await _no_turn_beat(NoopRunAdmission())
    checked, decisions = await _no_turn_beat(world.admission)
    assert decisions, "a beat without a turn id is checked"
    assert len(checked) == len(noop) == HB_FIRST


async def test_checked_beat_with_agent_adds_one(world):
    for agent in (world.shared_agent, world.private_agent):
        statements = await _first_beat_statements(world, references=world.refs[agent])
        assert len(statements) == HB_FIRST + 1, agent

    # The one added statement is `resolve_agent_artifact_id`: without admission the
    # same beat costs HB_FIRST.
    noop = await _first_beat_statements(
        world, references=world.refs[world.shared_agent], admission=NoopRunAdmission()
    )
    assert len(noop) == HB_FIRST


async def test_create_beat_columns_ride_the_insert(world):
    async def _create(references) -> List[str]:
        await _beat(world, _sid(), str(uuid4()), references=references)  # warm
        session_id = _sid()
        with count_statements(get_transactions_engine()) as statements:
            result = await _beat(world, session_id, str(uuid4()), references=references)
        assert result.is_current_turn and result.stream is not None
        return statements

    plain = await _create(None)
    assert len(plain) == HB_CREATE
    # The insert carries the policy columns: no UPDATE on the normal create path.
    assert [s for s in plain if s.lstrip().upper().startswith("UPDATE")] == []
    inserts = [s for s in plain if s.lstrip().upper().startswith("INSERT")]
    assert len(inserts) == 1
    assert "visibility" in inserts[0] and "owner_user_id" in inserts[0]

    with_agent = await _create(world.refs[world.shared_agent])
    assert len(with_agent) == HB_CREATE + 1


async def test_refused_beat_writes_nothing(world):
    """Bob's running beat on Alice's private session: refused before any lock or
    write. Only SELECTs: the moved row read, plus the reference read with an agent."""

    session_id = _sid()
    await _beat(world, session_id, str(uuid4()))  # Alice creates her private session

    for references, expected in (
        (None, 1),
        (world.refs[world.shared_agent], 2),
    ):
        for attempt in range(2):  # the second refusal is the warm one
            with count_statements(get_transactions_engine()) as statements:
                with pytest.raises(AdmissionDenied):
                    await _beat(
                        world,
                        session_id,
                        str(uuid4()),
                        user_id=world.bob,
                        references=references,
                    )
        assert len(statements) == expected, references
        assert all(s.lstrip().upper().startswith("SELECT") for s in statements)


# -- send, lists, agent queries -------------------------------------------------------


async def test_send_unchanged(world):
    async def _send(session_id: str):
        return await world.streams.command(
            project_id=world.project_id,
            user_id=world.alice,
            request=SessionStreamCommandRequest(
                session_id=session_id,
                data={"inputs": {"messages": [{"role": "user", "content": "OK?"}]}},
            ),
            access=world.private_policy(world.alice),
        )

    await _send(_sid())  # warm
    with count_statements(get_transactions_engine()) as statements:
        response = await _send(_sid())
    assert response.turn_id
    assert len(statements) == SEND


async def test_session_lists_unchanged(world):
    """`POST /sessions/query` and `POST /sessions/streams/query` as the routes run
    them: the read scope (from `sharing_user_grants` and the owner membership cache),
    then the page. Bob holds a grant on Alice's private session; an API key has no
    private scope."""

    private_session = _sid()
    await _beat(world, private_session, str(uuid4()))  # Alice's private session
    await _beat(world, _sid(), str(uuid4()))  # another one, not granted
    # A project-visible session, so every caller's page is not empty (the second
    # statement of SQ reads the latest turn of the listed sessions).
    project_session = _sid()
    await _beat(world, project_session, str(uuid4()), access=OWNERLESS_PROJECT_POLICY)
    (row,) = [
        r
        for r in await world.streams.query_streams(
            project_id=world.project_id,
            read_scope=await sharing_module.get_sharing_service().session_read_scope(
                project_id=world.project_id,
                principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.alice),
            ),
            filter=SessionStreamQuery(
                session_id=private_session,
                flags=SessionStreamQueryFlags(is_alive=None, is_running=None),
            ),
        )
    ]
    await execute(
        "INSERT INTO session_grants (project_id, stream_id, user_id, role) "
        "VALUES (:p, :s, :u, 'viewer')",
        {"p": world.project_id, "s": row.id, "u": world.bob},
    )

    normalized = normalize_session_query_request(SessionQueryRequest())
    sharing = sharing_module.get_sharing_service()
    principals = {
        "human with a grant": PrincipalRef(kind=PrincipalKind.HUMAN, id=world.bob),
        "api_key": PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4()),
    }

    for label, principal in principals.items():

        async def _sq():
            return await world.sessions.query_sessions_page(
                project_id=world.project_id,
                read_scope=await sharing.session_read_scope(
                    project_id=world.project_id, principal=principal
                ),
                query=normalized.predicates,
                lifecycle=normalized.lifecycle,
                options=normalized.options,
                windowing=normalized.windowing,
            )

        async def _ssq():
            return await world.streams.query_streams(
                project_id=world.project_id,
                read_scope=await sharing.session_read_scope(
                    project_id=world.project_id, principal=principal
                ),
                filter=SessionStreamQuery(
                    session_id=None,
                    flags=SessionStreamQueryFlags(is_alive=None, is_running=None),
                ),
            )

        await _sq()
        with count_statements(get_transactions_engine()) as statements:
            page = await _sq()
        assert len(statements) == SQ, label
        listed = {s.session_id for s in page.sessions}
        assert project_session in listed, label
        assert (private_session in listed) is (label == "human with a grant")

        await _ssq()
        with count_statements(get_transactions_engine()) as statements:
            rows = await _ssq()
        assert len(statements) == SSQ, label
        assert (private_session in {r.session_id for r in rows}) is (
            label == "human with a grant"
        )


async def test_agent_queries_unchanged(world):
    sharing = sharing_module.get_sharing_service()
    for user_id, sees_private in ((world.alice, True), (world.bob, False)):
        principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)

        async def _scope():
            return await sharing.agent_read_scope(principal=principal)

        for expected, query in (
            (
                WQ,
                lambda scope: world.workflows.query_workflows(
                    project_id=world.project_id, read_scope=scope
                ),
            ),
            (
                WVQ,
                lambda scope: world.workflows.query_workflow_variants(
                    project_id=world.project_id, read_scope=scope
                ),
            ),
            (
                WRQ,
                lambda scope: world.workflows.query_workflow_revisions(
                    project_id=world.project_id, read_scope=scope
                ),
            ),
        ):
            await query(await _scope())
            with count_statements(get_transactions_engine()) as statements:
                items = await query(await _scope())
            assert len(statements) == expected, (user_id, expected)
            agents = {
                getattr(i, "workflow_id", None)
                or getattr(i, "artifact_id", None)
                or i.id
                for i in items
            }
            assert world.shared_agent in agents
            assert (world.private_agent in agents) is sees_private


async def test_warm_session_and_agent_decisions_read_nothing(world):
    session_id = _sid()
    await _beat(world, session_id, str(uuid4()))  # Alice's private session

    for user_id, allowed in ((world.alice, True), (world.bob, False)):
        access = make_request_access(
            envelope=world.envelope(user_id), credential_kind="bearer_session"
        )
        for action, resource in (
            (
                Permission.VIEW_SESSIONS,
                ResourceRef(kind=ResourceKind.SESSION, id=session_id),
            ),
            (
                Permission.VIEW_WORKFLOWS,
                ResourceRef(kind=ResourceKind.AGENT, id=str(world.private_agent)),
            ),
        ):

            async def _check():
                # One request: its own request access and memo.
                token = set_request_access(access)
                try:
                    return await world.access.check_request(
                        access=access,
                        action=action,
                        project_id=world.project_id,
                        resource=resource,
                    )
                finally:
                    reset_request_access(token)

            await _check()
            with count_statements(get_transactions_engine()) as statements:
                decision = await _check()
            assert decision.allowed is allowed, (user_id, resource.kind)
            assert statements == [], (user_id, resource.kind)


# -- server boundaries -----------------------------------------------------------------


async def test_queued_dispatch_adds_no_statement(world, monkeypatch):
    """A queued input of Alice's private session that runs her private agent:
    `admit_request` and the invoke prelude cost what the prelude alone cost before
    admission (the target is resolved once, in `admit_request`)."""

    session_id = _sid()
    await _beat(world, session_id, str(uuid4()))
    started = AsyncMock(return_value={"started": True})
    monkeypatch.setattr(world.workflows, "_stream_service_started", started)
    envelope = world.envelope(world.alice)

    def _command() -> SessionCommand:
        return SessionCommand(
            id=uuid4(),
            project_id=world.project_id,
            session_id=session_id,
            kind=SessionCommandKind.continue_input,
            target_turn_id=str(uuid4()),
            state=SessionCommandState.claimed,
            data={
                "request": {
                    "references": {"workflow": {"id": str(world.private_agent)}},
                    "data": {
                        "inputs": {"messages": [{"role": "user", "content": "hi"}]}
                    },
                }
            },
            created_by_id=world.alice,
            run_envelope=envelope,
        )

    async def _dispatch(admission) -> List[str]:
        await deliver_continue_input(
            command=_command(),
            workflows_service=world.workflows,
            run_admission=admission,
        )
        with count_statements(get_transactions_engine()) as statements:
            await deliver_continue_input(
                command=_command(),
                workflows_service=world.workflows,
                run_admission=admission,
            )
        return statements

    before = await _dispatch(NoopRunAdmission())
    after = await _dispatch(world.admission)
    assert started.await_count == 4
    assert before, "the dispatch must have reached Postgres"
    assert len(after) == len(before)


async def test_trigger_tick_adds_no_statement(world):
    """A real tick on Alice's schedule of her private agent: real `TriggersDAO`, real
    claim, real target resolution; only the detached dispatch is a stub. With the real
    admission the tick sends as many statements as with a no-op admission and an
    always-allow access service, and no access-decision statement."""

    from oss.src.core.triggers.dtos import TriggerScheduleCreate, TriggerScheduleData
    from oss.src.dbs.postgres.triggers.dao import TriggersDAO
    from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher

    engine = get_transactions_engine()
    triggers = TriggersDAO(engine=engine)
    claims = SessionStreamsDAO(engine=engine)
    schedule = await triggers.create_schedule(
        project_id=world.project_id,
        user_id=world.alice,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=world.alice),
        artifact_id=world.private_agent,
        schedule=TriggerScheduleCreate(
            name="m3-count",
            data=TriggerScheduleData(
                event_key="cron.tick",
                schedule="0 0 1 1 *",
                references={"workflow": {"id": str(world.private_agent)}},
            ),
        ),
    )

    async def _tick(access_service, admission, event_id):
        dispatch = AsyncMock(return_value="run-1")
        await TriggersDispatcher(
            run_admission=admission,
            triggers_dao=triggers,
            session_claims_dao=claims,
            workflows_service=world.workflows,
            dispatch_fn=dispatch,
            access_service=access_service,
        ).dispatch_schedule(
            project_id=world.project_id,
            schedule=schedule,
            event_id=event_id,
            event={},
        )
        return dispatch

    stub = AllowingAccessService(organization_id=world.organization_id)
    await _tick(stub, NoopRunAdmission(), "warm-stub")
    with count_statements_by_phase(engine) as before:
        await _tick(stub, NoopRunAdmission(), "tick-stub")

    await _tick(world.access, world.admission, "warm-real")
    with count_statements_by_phase(engine) as after:
        dispatch = await _tick(world.access, world.admission, "tick-real")

    dispatch.assert_awaited_once()
    assert before["endpoint"], "the tick must have reached Postgres"
    assert after["access"] == []
    assert len(after["endpoint"]) == len(before["endpoint"])

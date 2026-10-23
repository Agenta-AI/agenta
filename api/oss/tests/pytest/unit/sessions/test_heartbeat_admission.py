"""Every heartbeat is authorized before any lock, write or response; only a running beat
of a turn its principal was already admitted to skips the check (verified continuity).

Real `SessionStreamsService` over an in-memory DAO and the fake Redis of the lock
tests. Alice owns the private session `alice-private`; Bob is a project member who is
neither its owner nor (unless a test says so) a grantee.
"""

import asyncio
from types import SimpleNamespace
from typing import Dict, List, Optional, Set
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import oss.src.core.sessions.streams.service as service_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.apis.fastapi.sharing.utils import NOT_FOUND_ERROR
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    ResourceKind,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamFlags,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sharing.admission import RunAdmission
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    Visibility,
)
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.workflows.types import AgentReferenceUnresolved
from oss.src.dbs.redis.sessions.contract import (
    TURN_BOUND_TTL_SECONDS,
    turn_admitted_key,
    superseded_key,
)
from oss.src.dbs.redis.sessions.locks import bind_turn
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import (
    RecordingRunAdmission,
    RuleAccessService,
    register_sharing_service_for_tests,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


pytestmark = pytest.mark.asyncio

_PROJECT = uuid4()
_ORGANIZATION = uuid4()
_ALICE = uuid4()
_BOB = uuid4()
_SESSION = "alice-private"
_PRIVATE = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=_ALICE)


# -- fakes ------------------------------------------------------------------------------


class _DAO:
    """One table of rows keyed by session id, with call counts. `before_create`, when
    set, is awaited inside `create` before the insert (orders a create race)."""

    def __init__(self) -> None:
        self.rows: Dict[str, SessionStream] = {}
        self.policies: Dict[str, AccessPolicy] = {}
        self.calls: List[str] = []
        self.before_create = None

    def seed(self, *, session_id=_SESSION, policy=_PRIVATE, **fields) -> SessionStream:
        row = SessionStream(
            id=uuid4(), project_id=_PROJECT, session_id=session_id, **fields
        )
        self.rows[session_id] = row
        self.policies[session_id] = policy
        return row

    def count(self, name: str) -> int:
        return self.calls.count(name)

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        self.calls.append("get_by_session_id")
        return self.rows.get(session_id)

    async def create(self, *, project_id, user_id, stream):
        self.calls.append("create")
        if self.before_create is not None:
            hook, self.before_create = self.before_create, None
            await hook(stream)
        if stream.session_id in self.rows:
            raise SessionStreamAlreadyExists(session_id=stream.session_id)
        row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            flags=stream.flags or SessionStreamFlags(),
            turn_id=stream.turn_id,
            name=stream.name,
            references=stream.references,
            visibility=stream.access.visibility,
            owner_user_id=stream.access.owner_user_id,
        )
        self.rows[stream.session_id] = row
        self.policies[stream.session_id] = stream.access
        return row

    async def update(self, *, project_id, user_id, session_id, stream):
        self.calls.append("update")
        prior = self.rows.get(session_id)
        if prior is None:
            return None
        row = prior.model_copy(
            update={
                "flags": stream.flags if stream.flags is not None else prior.flags,
                "turn_id": stream.turn_id
                if stream.turn_id is not None
                else prior.turn_id,
            }
        )
        self.rows[session_id] = row
        return row

    async def fill_missing(self, *, project_id, session_id, name, references):
        self.calls.append("fill_missing")

    async def update_header(self, *, project_id, user_id, session_id, header, **_):
        self.calls.append("update_header")
        prior = self.rows.get(session_id)
        if prior is None:
            return None
        return prior

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


class _ClockRedis(_FakeRedis):
    """The fake Redis with a clock: a key whose TTL ran out is gone."""

    def __init__(self) -> None:
        super().__init__()
        self.now = 0.0
        self.deadlines: Dict[str, float] = {}
        outer = self

        class _Deadlines(dict):
            def __setitem__(self, key, ttl):
                outer.deadlines[key] = outer.now + int(ttl)
                super().__setitem__(key, ttl)

        self._ttl = _Deadlines()

    def advance(self, seconds: float) -> None:
        self.now += seconds
        for key, deadline in list(self.deadlines.items()):
            if deadline <= self.now:
                self._values.pop(key, None)
                self._ttl.pop(key, None)
                self.deadlines.pop(key, None)


class _World:
    """Who may run and read the session, and which agents are private. Drives
    `RecordingRunAdmission` like the sharing rules would."""

    def __init__(self, dao: _DAO) -> None:
        self.dao = dao
        self.participants: Set[UUID] = set()
        self.viewers: Set[UUID] = set()
        self.private_agents: Dict[str, UUID] = {}  # slug -> owner

    def refuse(self, method: str, kwargs: dict):
        principal = kwargs["envelope"].authority.principal
        decision = Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED)
        session_id = kwargs.get("session_id")
        policy = self.dao.policies.get(session_id) if session_id else None
        if (
            policy is not None
            and policy.visibility == Visibility.PRIVATE
            and principal.id != policy.owner_user_id
            and principal.id not in self.participants
        ):
            return AdmissionDenied(
                decision=decision,
                readable=principal.id in self.viewers,
                boundary="heartbeat",
            )
        for reference in kwargs.get("references") or []:
            owner = self.private_agents.get(reference.slug)
            if owner is not None and owner != principal.id:
                return AdmissionDenied(
                    decision=decision, readable=False, boundary="heartbeat"
                )
        return None


# -- fixtures and helpers ---------------------------------------------------------------


@pytest_asyncio.fixture
async def redis():
    return _ClockRedis()


@pytest_asyncio.fixture
async def lock_engine(redis):
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=redis):
        yield engine


@pytest.fixture
def dao():
    return _DAO()


@pytest.fixture
def world(dao):
    return _World(dao)


@pytest.fixture
def admission(world):
    return RecordingRunAdmission(refuse=world.refuse)


@pytest.fixture
def service(dao, lock_engine):
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


@pytest.fixture
def spies(monkeypatch):
    """Counts every lock helper the beat calls after authorization, and the admission
    record reads and writes."""

    counts: Dict[str, int] = {}
    names = [
        "is_turn_superseded",
        "bind_turn",
        "refresh_alive",
        "acquire_alive_with_start",
        "acquire_running",
        "refresh_running",
        "release_running",
        "record_turn_start",
        "get_turn_admission",
        "record_turn_admission",
    ]
    for name in names:
        original = getattr(service_module, name)

        def _wrap(original=original, name=name):
            async def _spy(*args, **kwargs):
                counts[name] = counts.get(name, 0) + 1
                return await original(*args, **kwargs)

            return _spy

        monkeypatch.setattr(service_module, name, _wrap())
    return counts


_LOCKS = (
    "is_turn_superseded",
    "bind_turn",
    "refresh_alive",
    "acquire_alive_with_start",
    "acquire_running",
    "refresh_running",
    "release_running",
    "record_turn_start",
)

_ALICE_ENVELOPE = make_envelope(
    principal_id=_ALICE, project_id=_PROJECT, organization_id=_ORGANIZATION
)
_BOB_ENVELOPE = make_envelope(
    principal_id=_BOB, project_id=_PROJECT, organization_id=_ORGANIZATION
)


def _beat(
    turn_id: Optional[str] = "t1",
    *,
    running: bool = True,
    replica: str = "replica-a",
    session_id: str = _SESSION,
    references: Optional[List[SessionReference]] = None,
) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=session_id,
        replica_id=replica,
        turn_id=turn_id,
        is_running=running,
        references=references,
    )


async def _send(service, admission, request, envelope=_ALICE_ENVELOPE, access=None):
    return await service.heartbeat(
        project_id=_PROJECT,
        request=request,
        envelope=envelope,
        access=access or OWNERLESS_PROJECT_POLICY,
        run_admission=admission,
        admission_envelope=envelope,
    )


def _no_lock_touched(spies) -> bool:
    return all(spies.get(name, 0) == 0 for name in _LOCKS)


# -- verified continuity ----------------------------------------------------------------


async def test_steady_beats_of_the_admitted_run_skip_the_check(
    service, admission, dao, spies
):
    dao.seed()
    for _ in range(5):
        result = await _send(service, admission, _beat("t1"))
        assert result.is_current_turn is True

    assert admission.methods() == ["admit_turn"]
    assert admission.calls[0][1]["session_id"] == _SESSION
    # Beat 1 is checked (the row's turn is not t1 yet); beats 2 to 5 read the record.
    assert spies["get_turn_admission"] == 4
    assert spies["record_turn_admission"] == 1


async def test_prior_stream_is_read_once_per_beat(service, admission, dao):
    dao.seed()
    for beat in range(3):
        before = dao.count("get_by_session_id")
        await _send(service, admission, _beat("t1"))
        assert dao.count("get_by_session_id") - before == 1, f"beat {beat + 1}"


async def test_lost_admission_record_rechecks_once(service, admission, dao, redis):
    dao.seed()
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1"))
    assert admission.methods() == ["admit_turn"]

    await redis.delete(turn_admitted_key(str(_PROJECT), _SESSION, "t1"))
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1"))
    assert admission.methods() == ["admit_turn", "admit_turn"]


async def test_verified_beat_renews_the_admission_ttl(service, admission, dao, redis):
    dao.seed()
    key = turn_admitted_key(str(_PROJECT), _SESSION, "t1")
    step = TURN_BOUND_TTL_SECONDS * 3 / 10
    for _ in range(10):
        await _send(service, admission, _beat("t1"))
        assert redis.deadlines[key] == redis.now + TURN_BOUND_TTL_SECONDS
        redis.advance(step)

    # Ten beats span three TTLs; the record never expired, so only beat 1 was checked.
    assert redis.now >= 3 * TURN_BOUND_TTL_SECONDS
    assert admission.methods() == ["admit_turn"]


async def test_admission_record_error_fails_closed(
    service, admission, dao, world, redis
):
    world.participants.add(_BOB)
    dao.seed()
    await _send(service, admission, _beat("t1"), envelope=_BOB_ENVELOPE)
    world.participants.discard(_BOB)

    async def _broken(*_args, **_kwargs):
        raise ConnectionError("redis down")

    redis.getex = _broken
    with pytest.raises(AdmissionDenied):
        await _send(service, admission, _beat("t1"), envelope=_BOB_ENVELOPE)
    # Alice's beat is checked too: an unreadable record is never continuity.
    await _send(service, admission, _beat("t1"))
    assert admission.methods() == ["admit_turn", "admit_turn", "admit_turn"]


# -- checked beats ----------------------------------------------------------------------


async def test_beat_without_turn_id_is_checked(service, admission, dao, spies):
    dao.seed()
    with pytest.raises(AdmissionDenied) as error:
        await _send(service, admission, _beat(None), envelope=_BOB_ENVELOPE)
    assert error.value.readable is False
    assert admission.methods() == ["admit"]
    assert dao.count("update") == dao.count("fill_missing") == 0
    assert _no_lock_touched(spies)


async def test_not_running_beat_is_checked(service, admission, dao, spies):
    dao.seed(turn_id="t1")
    with pytest.raises(AdmissionDenied):
        await _send(
            service, admission, _beat("t1", running=False), envelope=_BOB_ENVELOPE
        )
    assert admission.methods() == ["admit"]
    assert admission.calls[0][1]["agent_artifact_id"] is None
    assert dao.count("update") == 0
    assert _no_lock_touched(spies)


async def test_foreign_credential_with_admitted_turn_id_is_refused(
    service, admission, dao, spies
):
    dao.seed()
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1"))
    updates = dao.count("update")

    with pytest.raises(AdmissionDenied):
        await _send(service, admission, _beat("t1"), envelope=_BOB_ENVELOPE)
    assert admission.methods() == ["admit_turn", "admit_turn"]
    assert admission.calls[-1][1]["envelope"] == _BOB_ENVELOPE
    assert dao.count("update") == updates


async def test_superseded_and_other_replica_branches_are_checked_first(
    service, admission, dao, redis, lock_engine
):
    dao.seed()
    # A superseded turn.
    await redis.set(superseded_key(str(_PROJECT), _SESSION, "t-dead"), b"1")
    with pytest.raises(AdmissionDenied):
        await _send(service, admission, _beat("t-dead"), envelope=_BOB_ENVELOPE)

    # A turn bound to another replica.
    await bind_turn(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="t-bound",
        replica_id="replica-a",
        replica_address="",
    )
    with pytest.raises(AdmissionDenied):
        await _send(
            service,
            admission,
            _beat("t-bound", replica="replica-b"),
            envelope=_BOB_ENVELOPE,
        )
    assert admission.methods() == ["admit_turn", "admit_turn"]


async def test_superseded_branch_reuses_the_row(service, admission, dao, redis):
    dao.seed()
    await redis.set(superseded_key(str(_PROJECT), _SESSION, "t-dead"), b"1")
    result = await _send(service, admission, _beat("t-dead"))
    assert result.is_current_turn is False
    assert result.stream is not None
    assert dao.count("get_by_session_id") == 1


async def test_stopped_beat_of_admitted_principal_is_checked(service, admission, dao):
    dao.seed()
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1", running=False))
    assert admission.methods() == ["admit_turn", "admit"]
    assert admission.calls[-1][1]["session_id"] == _SESSION


async def test_admission_uses_the_beat_references_not_the_row(
    service, admission, dao, world
):
    world.private_agents["q"] = _ALICE
    dao.seed(references=[SessionReference(key="workflow", slug="p")])
    world.participants.add(_BOB)
    beat_references = [SessionReference(key="workflow", slug="q")]
    with pytest.raises(AdmissionDenied):
        await _send(
            service,
            admission,
            _beat("t1", references=beat_references),
            envelope=_BOB_ENVELOPE,
        )
    assert admission.calls[0][1]["references"] == beat_references


async def test_new_turn_on_existing_row_admits_again(service, admission, dao):
    dao.seed()
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t1"))
    await _send(service, admission, _beat("t2"))
    assert admission.methods() == ["admit_turn", "admit_turn"]
    assert admission.calls[-1][1]["session_id"] == _SESSION


async def test_refused_beat_touches_no_lock_and_no_row(service, dao, spies):
    def _refuse(method, kwargs):
        return AdmissionDenied(
            decision=Decision(allowed=False, reason=DecisionReason.RESOURCE_DENIED),
            readable=False,
            boundary="heartbeat",
        )

    admission = RecordingRunAdmission(refuse=_refuse)
    with pytest.raises(AdmissionDenied):
        await _send(service, admission, _beat("t1", session_id="new-session"))
    assert admission.methods() == ["admit_turn"]
    assert admission.calls[0][1]["session_id"] is None
    assert dao.count("create") == dao.count("update") == 0
    assert dao.count("fill_missing") == 0
    assert _no_lock_touched(spies)
    assert spies.get("record_turn_admission", 0) == 0


# -- create -----------------------------------------------------------------------------


async def test_create_beat_inserts_once_with_initial_flags(service, admission, dao):
    await _send(service, admission, _beat("t1", session_id="fresh"), access=_PRIVATE)
    row = dao.rows["fresh"]
    assert dao.count("create") == 1
    assert dao.count("update") == 0, "the insert matched the locks: no mirror write"
    assert row.turn_id == "t1"
    assert row.flags == SessionStreamFlags(
        is_alive=True, is_running=True, is_attached=False
    )
    assert row.owner_user_id == _ALICE
    assert admission.methods() == ["admit_turn"]
    assert admission.calls[0][1]["session_id"] is None


async def test_concurrent_create_authorizes_the_winning_row(
    service, admission, dao, spies, lock_engine, sharing
):
    alice_created = asyncio.Event()

    async def _wait_for_alice(_stream):
        await alice_created.wait()

    dao.before_create = _wait_for_alice
    router = SessionStreamsRouter(
        service=service,
        interactions_service=SimpleNamespace(),
        run_admission=admission,
    )
    bob = asyncio.create_task(
        _route_beat(router, _beat("t-bob", session_id="race"), _BOB_ENVELOPE)
    )
    await asyncio.sleep(0)
    while dao.count("create") == 0:
        await asyncio.sleep(0)

    # Alice names her new private session first (`set_header` creates the row).
    await service.set_header(
        project_id=_PROJECT,
        user_id=_ALICE,
        session_id="race",
        header=SessionStreamHeaderEdit(name="Alice's chat"),
        access=_PRIVATE,
    )
    alice_created.set()

    with pytest.raises(HTTPException) as error:
        await bob
    assert error.value.status_code == 404
    assert error.value.detail == NOT_FOUND_ERROR.model_dump(exclude_none=True)
    # The winning row was read and checked for Bob, before any lock or write.
    assert admission.methods() == ["admit_turn", "admit_turn"]
    assert admission.calls[1][1]["session_id"] == "race"
    assert _no_lock_touched(spies)
    assert dao.count("update") == dao.count("fill_missing") == 0
    assert spies.get("record_turn_admission", 0) == 0
    from oss.src.dbs.redis.sessions.locks import get_turn_admission

    assert (
        await get_turn_admission(
            lock_engine, project_id=str(_PROJECT), session_id="race", turn_id="t-bob"
        )
        is None
    )

    # Bob's next beat with the same turn id is checked again and refused.
    with pytest.raises(HTTPException) as again:
        await _route_beat(router, _beat("t-bob", session_id="race"), _BOB_ENVELOPE)
    assert again.value.status_code == 404
    assert admission.methods()[-1] == "admit_turn"


async def test_concurrent_create_winner_readable_by_participant(
    service, admission, dao, world, spies
):
    world.participants.add(_BOB)
    alice_created = asyncio.Event()

    async def _wait_for_alice(_stream):
        await alice_created.wait()

    dao.before_create = _wait_for_alice
    bob = asyncio.create_task(
        _send(service, admission, _beat("t-bob", session_id="race"), _BOB_ENVELOPE)
    )
    while dao.count("create") == 0:
        await asyncio.sleep(0)
    await service.set_header(
        project_id=_PROJECT,
        user_id=_ALICE,
        session_id="race",
        header=SessionStreamHeaderEdit(name="Alice's chat"),
        access=_PRIVATE,
    )
    alice_created.set()

    result = await bob
    assert result.stream is not None
    assert result.stream.owner_user_id == _ALICE
    assert admission.methods() == ["admit_turn", "admit_turn"]
    assert spies["record_turn_admission"] == 1


# -- the route --------------------------------------------------------------------------


async def _route_beat(router, payload, envelope):
    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(_PROJECT),
            user_id=str(envelope.authority.principal.id),
            run_envelope=envelope,
            authority=envelope.authority,
        ),
        headers={},
    )
    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        return await router.heartbeat_session_stream(request, payload)


_PRIVATE_AGENT = uuid4()


class _Workflows:
    """`resolve_agent_artifact_id`: `private` is Alice's private agent; `unknown`,
    `archived` and `foreign` resolve to nothing."""

    async def resolve_agent_artifact_id(self, *, project_id, references):
        if not references:
            return None
        slug = references[0].slug
        if slug == "private":
            return _PRIVATE_AGENT
        raise AgentReferenceUnresolved()


def _rule(dao: _DAO, viewers: Set[UUID]):
    def rule(principal, action, resource):
        if resource is None:
            return True
        if resource.kind == ResourceKind.AGENT:
            return resource.id != str(_PRIVATE_AGENT) or principal.id == _ALICE
        policy = dao.policies.get(resource.id)
        if policy is None or policy.visibility == Visibility.PROJECT:
            return True
        if principal.id == policy.owner_user_id:
            return True
        return action == Permission.VIEW_SESSIONS and principal.id in viewers

    return rule


def _app(service, dao, viewers) -> TestClient:
    admission = RunAdmission(
        access_service=RuleAccessService(_rule(dao, viewers)),
        workflows_service=_Workflows(),
    )
    app = FastAPI()

    @app.middleware("http")
    async def _scope(request: Request, call_next):
        request.state.project_id = str(_PROJECT)
        request.state.user_id = str(_BOB)
        request.state.run_envelope = _BOB_ENVELOPE
        request.state.authority = _BOB_ENVELOPE.authority
        return await call_next(request)

    router = SessionStreamsRouter(
        service=service, interactions_service=SimpleNamespace(), run_admission=admission
    )
    app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def sharing(monkeypatch):
    return register_sharing_service_for_tests(monkeypatch)


def _post(client, **beat):
    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        return client.post("/sessions/streams/heartbeat", json=beat)


async def test_refused_beat_answers_404_or_403_through_the_real_router(
    service, dao, sharing
):
    dao.seed()
    viewers: Set[UUID] = set()
    client = _app(service, dao, viewers)

    hidden = _post(client, session_id=_SESSION, replica_id="r", turn_id="t1")
    assert hidden.status_code == 404
    assert hidden.json()["detail"] == NOT_FOUND_ERROR.model_dump(exclude_none=True)

    viewers.add(_BOB)
    readable = _post(client, session_id=_SESSION, replica_id="r", turn_id="t1")
    assert readable.status_code == 403
    assert readable.json()["detail"]["code"] == "access_denied"
    assert readable.json()["detail"]["details"]["reason"] == "resource_denied"
    assert dao.count("update") == 0


@pytest.mark.parametrize(
    "target",
    [
        "private_session",
        "private_agent",
        "unknown_ref",
        "archived_ref",
        "foreign_project_ref",
    ],
)
async def test_hiding_refusals_have_one_body(service, dao, sharing, target):
    references = None
    session_id = _SESSION
    if target == "private_session":
        dao.seed()
    else:
        session_id = "project-session"
        dao.seed(session_id=session_id, policy=OWNERLESS_PROJECT_POLICY)
        slug = {
            "private_agent": "private",
            "unknown_ref": "unknown",
            "archived_ref": "archived",
            "foreign_project_ref": "foreign",
        }[target]
        references = [{"key": "workflow", "slug": slug}]
    client = _app(service, dao, set())

    response = _post(
        client,
        session_id=session_id,
        replica_id="r",
        turn_id="t1",
        references=references,
    )
    assert response.status_code == 404
    assert response.json()["detail"] == NOT_FOUND_ERROR.model_dump(exclude_none=True)


async def test_beat_without_an_envelope_answers_not_found(service, dao):
    dao.seed()
    router = SessionStreamsRouter(
        service=service,
        interactions_service=SimpleNamespace(),
        run_admission=RecordingRunAdmission(),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(_PROJECT), user_id=str(_BOB)),
        headers={},
    )
    with (
        patch(
            "oss.src.apis.fastapi.sessions.router.check_action_access",
            new_callable=AsyncMock,
            return_value=True,
        ),
        pytest.raises(HTTPException) as error,
    ):
        await router.heartbeat_session_stream(request, _beat("t1"))
    assert error.value.status_code == 404
    assert dao.count("get_by_session_id") == 0


async def test_admission_record_read_falls_back_without_getex(lock_engine, redis):
    from redis.exceptions import ResponseError

    from oss.src.dbs.redis.sessions.locks import (
        get_turn_admission,
        record_turn_admission,
    )

    principal = _ALICE_ENVELOPE.authority.principal
    await record_turn_admission(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="t1",
        principal=principal,
    )
    key = turn_admitted_key(str(_PROJECT), _SESSION, "t1")
    redis.advance(TURN_BOUND_TTL_SECONDS / 2)

    async def _no_getex(*_args, **_kwargs):
        raise ResponseError("unknown command 'GETEX'")

    class _Pipeline:
        def __init__(self):
            self.ops = []

        def get(self, name):
            self.ops.append(("get", name))

        def expire(self, name, ttl):
            self.ops.append(("expire", name, ttl))

        async def execute(self):
            results = []
            for op in self.ops:
                if op[0] == "get":
                    results.append(await redis.get(op[1]))
                else:
                    results.append(await redis.expire(op[1], op[2]))
            return results

    redis.getex = _no_getex
    redis.pipeline = lambda transaction=True: _Pipeline()

    assert (
        await get_turn_admission(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="t1"
        )
        == principal
    )
    assert redis.deadlines[key] == redis.now + TURN_BOUND_TTL_SECONDS


async def test_admission_record_write_error_is_swallowed(lock_engine, redis):
    from oss.src.dbs.redis.sessions.locks import record_turn_admission

    async def _broken(*_args, **_kwargs):
        raise ConnectionError("redis down")

    redis.set = _broken
    await record_turn_admission(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="t1",
        principal=_ALICE_ENVELOPE.authority.principal,
    )

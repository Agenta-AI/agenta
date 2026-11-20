"""The session origin record: one mapping from the creating run's origin to the
session origin, the calling session record, and how both read back."""

from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.access.context import _request_memo
from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStreamCommandRequest,
    SessionStreamHeaderEdit,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamFlags,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.types import (
    SessionCallingSession,
    SessionOrigin,
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.sharing.dtos import OWNERLESS_PROJECT_POLICY
from oss.src.core.sharing.service import _note_missing_session
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    SESSION_RESERVED_TAG_KEYS,
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
    map_stream_dto_to_dbe_edit,
    map_stream_dto_to_dbe_header_edit,
    session_origin_tags,
)
from oss.tests.pytest.utils.principals import make_envelope
from oss.tests.pytest.utils.sharing import NoopRunAdmission
from unit.sessions.test_project_scoped_locks import _FakeRedis

_PROJECT = uuid4()


def _calling_session() -> SessionCallingSession:
    return SessionCallingSession(
        id="calling-session",
        turn_id="calling-turn",
        agent_id=uuid4(),
        revision_id=uuid4(),
    )


def _trigger(kind: SessionTriggerKind) -> SessionTriggerAttribution:
    return SessionTriggerAttribution(
        configuration_id=uuid4(), kind=kind, delivery_id=uuid4()
    )


def _row(tags) -> SessionStreamDBE:
    return SessionStreamDBE(id=uuid4(), project_id=_PROJECT, session_id="s", tags=tags)


def _created(**fields) -> SessionStreamDBE:
    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(
            session_id="s", access=OWNERLESS_PROJECT_POLICY, **fields
        ),
    )
    dbe.id = uuid4()
    return dbe


# One row per `RunOrigin` value: the origin a session reads after a run with that
# origin creates it. `calling_session` comes with its record (see the round trip).
_ROWS = {
    RunOrigin.WEB: SessionOrigin.manual,
    RunOrigin.EVALUATION: SessionOrigin.manual,
    RunOrigin.CHILD: SessionOrigin.manual,
    RunOrigin.API: SessionOrigin.api,
    RunOrigin.INSTALLATION: SessionOrigin.channel,
    RunOrigin.SCHEDULE: SessionOrigin.trigger,
    RunOrigin.SUBSCRIPTION: SessionOrigin.trigger,
    RunOrigin.CALLING_SESSION: SessionOrigin.calling_session,
}


def test_every_run_origin_has_a_row():
    assert set(_ROWS) == set(RunOrigin)


@pytest.mark.parametrize(
    "run_origin", [value for value in RunOrigin if value != RunOrigin.CALLING_SESSION]
)
def test_the_creating_run_origin_maps_to_the_session_origin(run_origin):
    envelope = make_envelope(origin=run_origin.value)
    tags = session_origin_tags(envelope)

    stream = map_stream_dbe_to_dto(stream_dbe=_created(run_envelope=envelope))

    assert stream.origin == _ROWS[run_origin]
    # `manual` is never stamped: the row reads it from the missing tag.
    if _ROWS[run_origin] == SessionOrigin.manual:
        assert tags == {}
    else:
        assert tags == {"ag.origin": _ROWS[run_origin].value}
    assert stream.calling_session is None
    assert stream.tags is None


def test_an_untagged_row_reads_manual_with_no_objects():
    stream = map_stream_dbe_to_dto(stream_dbe=_row(None))

    assert stream.origin == SessionOrigin.manual
    assert stream.trigger is None
    assert stream.delivery is None
    assert stream.calling_session is None


def test_a_row_without_an_envelope_reads_manual():
    assert session_origin_tags(None) == {}
    assert map_stream_dbe_to_dto(stream_dbe=_created()).origin == SessionOrigin.manual


@pytest.mark.parametrize(
    "run_origin, kind",
    [
        (None, SessionTriggerKind.schedule),
        (RunOrigin.SCHEDULE, SessionTriggerKind.schedule),
        (RunOrigin.SUBSCRIPTION, SessionTriggerKind.subscription),
    ],
)
def test_a_fire_writes_trigger_and_its_objects(run_origin, kind):
    envelope = make_envelope(origin=run_origin.value) if run_origin else None
    attribution = _trigger(kind)

    tags = session_origin_tags(envelope, attribution)

    assert tags == {
        "ag.origin": "trigger",
        "ag.trigger.id": str(attribution.configuration_id),
        "ag.trigger.kind": kind.value,
        "ag.trigger.delivery_id": str(attribution.delivery_id),
    }
    stream = map_stream_dbe_to_dto(stream_dbe=_row(tags))
    assert stream.origin == SessionOrigin.trigger
    assert stream.trigger.id == attribution.configuration_id
    assert stream.delivery.id == attribution.delivery_id
    assert stream.calling_session is None


def test_the_calling_session_record_round_trips():
    calling_session = _calling_session()
    dbe = _created(
        run_envelope=make_envelope(origin="calling_session"),
        calling_session=calling_session,
    )

    assert dbe.tags == {
        "ag.origin": "calling_session",
        "ag.calling_session.id": "calling-session",
        "ag.calling_session.turn_id": "calling-turn",
        "ag.calling_session.agent_id": str(calling_session.agent_id),
        "ag.calling_session.revision_id": str(calling_session.revision_id),
    }
    assert set(dbe.tags) <= SESSION_RESERVED_TAG_KEYS
    stream = map_stream_dbe_to_dto(stream_dbe=dbe)
    assert stream.origin == SessionOrigin.calling_session
    assert stream.calling_session == calling_session
    # The raw reserved keys never reach a reader.
    assert stream.tags is None
    dumped = stream.model_dump(mode="json")
    assert dumped["calling_session"] == {
        "id": "calling-session",
        "turn_id": "calling-turn",
        "agent_id": str(calling_session.agent_id),
        "revision_id": str(calling_session.revision_id),
    }
    assert "run_envelope" not in SessionStreamCreate(
        session_id="s",
        access=OWNERLESS_PROJECT_POLICY,
        run_envelope=make_envelope(origin="calling_session"),
        calling_session=calling_session,
    ).model_dump(mode="json")


@pytest.mark.parametrize(
    "run_origin, attribution",
    [
        (RunOrigin.WEB, _trigger(SessionTriggerKind.schedule)),
        (RunOrigin.API, _calling_session()),
        (None, _calling_session()),
        # No row reads `calling_session` without its record.
        (RunOrigin.CALLING_SESSION, None),
    ],
)
def test_an_attribution_that_does_not_match_the_run_origin_is_refused(
    run_origin, attribution
):
    envelope = make_envelope(origin=run_origin.value) if run_origin else None
    with pytest.raises(ValueError):
        session_origin_tags(envelope, attribution)


def test_a_broken_calling_session_record_reads_as_none():
    stream = map_stream_dbe_to_dto(
        stream_dbe=_row(
            {
                "ag.origin": "calling_session",
                "ag.calling_session.id": "calling-session",
                "ag.calling_session.agent_id": "not-a-uuid",
            }
        )
    )

    assert stream.origin == SessionOrigin.calling_session
    assert stream.calling_session is None


def test_a_heartbeat_edit_keeps_the_record():
    calling_session = _calling_session()
    dbe = _created(
        run_envelope=make_envelope(origin="calling_session"),
        calling_session=calling_session,
    )

    map_stream_dto_to_dbe_edit(
        stream_dbe=dbe,
        user_id=None,
        stream=SessionStreamEdit(
            flags=SessionStreamFlags(is_alive=True, is_running=True),
            turn_id="turn-2",
        ),
    )

    stream = map_stream_dbe_to_dto(stream_dbe=dbe)
    assert stream.origin == SessionOrigin.calling_session
    assert stream.calling_session == calling_session


class _MappingDAO:
    """Stores the row as the real mappers write and read it."""

    def __init__(self):
        self.dbe = None

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return map_stream_dbe_to_dto(stream_dbe=self.dbe) if self.dbe else None

    async def create(self, *, project_id, user_id, stream):
        self.dbe = map_stream_dto_to_dbe_create(
            project_id=project_id, user_id=user_id, stream=stream
        )
        self.dbe.id = uuid4()
        return map_stream_dbe_to_dto(stream_dbe=self.dbe)

    async def update(self, *, project_id, user_id, session_id, stream):
        map_stream_dto_to_dbe_edit(stream_dbe=self.dbe, user_id=user_id, stream=stream)
        return map_stream_dbe_to_dto(stream_dbe=self.dbe)

    async def fill_missing(self, **kwargs):
        return map_stream_dbe_to_dto(stream_dbe=self.dbe)

    async def update_header(self, *, project_id, user_id, session_id, header, **kw):
        # A rename of a row that does not exist matches nothing: the create arm runs.
        if self.dbe is None:
            return None
        map_stream_dto_to_dbe_header_edit(
            stream_dbe=self.dbe,
            user_id=user_id,
            header=header,
            name_source=kw["name_source"],
        )
        return map_stream_dbe_to_dto(stream_dbe=self.dbe)


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_FakeRedis()):
        yield engine


@pytest.mark.parametrize(
    "run_origin, origin",
    [
        ("api", SessionOrigin.api),
        ("installation", SessionOrigin.channel),
        ("web", SessionOrigin.manual),
    ],
)
async def test_the_heartbeat_that_creates_the_row_records_its_origin_and_keeps_it(
    lock_engine, run_origin, origin
):
    dao = _MappingDAO()
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    envelope = make_envelope(origin=run_origin)

    async def beat(turn_id, run_envelope):
        await service.heartbeat(
            project_id=_PROJECT,
            request=SessionHeartbeatRequest(
                session_id="beaten",
                replica_id="replica-a",
                turn_id=turn_id,
                is_running=True,
            ),
            envelope=run_envelope,
            access=OWNERLESS_PROJECT_POLICY,
            run_admission=NoopRunAdmission(),
            admission_envelope=run_envelope,
        )

    await beat("turn-1", envelope)
    created = await dao.get_by_session_id(project_id=_PROJECT, session_id="beaten")
    assert created.origin == origin
    # A later beat, from a run with another origin, does not change it.
    await beat("turn-2", make_envelope(origin="web"))

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="beaten")
    assert stream.origin == origin


# The command route (`POST /sessions/streams/`) and the header route
# (`/sessions/streams/header`) create the row with the request's envelope
# (`request_run_envelope`): a person's token gives `web`, an API key `api`, and a run's
# secret token its own run origin.
_REQUEST_ROWS = [
    ("web", SessionOrigin.manual),
    ("api", SessionOrigin.api),
    ("installation", SessionOrigin.channel),
]


@pytest.fixture
def request_memo():
    token = _request_memo.set({})
    yield
    _request_memo.reset(token)


def _request_service(dao, lock_engine) -> SessionStreamsService:
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    service._publish_changed = AsyncMock()
    service._publish_lifecycle = AsyncMock()
    return service


async def _send(service, *, envelope, recheck=None):
    await service.command(
        project_id=_PROJECT,
        user_id=uuid4(),
        request=SessionStreamCommandRequest(
            session_id="sent", data={"inputs": {"messages": []}}
        ),
        access=OWNERLESS_PROJECT_POLICY,
        envelope=envelope,
        arrived_at_ms=1,
        recheck=recheck,
    )


@pytest.mark.parametrize("run_origin, origin", _REQUEST_ROWS)
async def test_a_send_that_creates_the_row_records_its_origin(
    lock_engine, run_origin, origin
):
    # The route found the row: `_start_turn` creates it.
    dao = _MappingDAO()
    service = _request_service(dao, lock_engine)

    await _send(service, envelope=make_envelope(origin=run_origin))

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="sent")
    assert stream.origin == origin


@pytest.mark.parametrize("run_origin, origin", _REQUEST_ROWS)
async def test_a_send_on_an_unchecked_id_records_its_origin(
    lock_engine, request_memo, run_origin, origin
):
    # The route found no row: the command inserts it before `_start_turn`.
    dao = _MappingDAO()
    service = _request_service(dao, lock_engine)
    _note_missing_session(project_id=_PROJECT, session_id="sent")

    await _send(service, envelope=make_envelope(origin=run_origin), recheck=AsyncMock())

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="sent")
    assert stream.origin == origin


async def test_a_later_send_does_not_change_the_origin(lock_engine):
    dao = _MappingDAO()
    service = _request_service(dao, lock_engine)
    await _send(service, envelope=make_envelope(origin="api"))
    await service._release_turn_locks(
        project_id=_PROJECT,
        session_id="sent",
        turn_id=dao.dbe.turn_id,
    )

    await _send(service, envelope=make_envelope(origin="web"))

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="sent")
    assert stream.origin == SessionOrigin.api


@pytest.mark.parametrize("run_origin, origin", _REQUEST_ROWS)
@pytest.mark.parametrize(
    "header",
    [
        SessionStreamHeaderEdit(name="Weekly report"),
        # No header field: the pre-create of a new chat (`_create_header_row`).
        SessionStreamHeaderEdit(),
    ],
)
async def test_a_header_call_that_creates_the_row_records_its_origin(
    lock_engine, header, run_origin, origin
):
    dao = _MappingDAO()
    service = _request_service(dao, lock_engine)

    await service.set_header(
        project_id=_PROJECT,
        user_id=uuid4(),
        session_id="named",
        header=header,
        access=OWNERLESS_PROJECT_POLICY,
        envelope=make_envelope(origin=run_origin),
    )

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="named")
    assert stream.origin == origin


async def test_a_rename_does_not_change_the_origin(lock_engine):
    dao = _MappingDAO()
    service = _request_service(dao, lock_engine)
    await _send(service, envelope=make_envelope(origin="api"))

    await service.set_header(
        project_id=_PROJECT,
        user_id=uuid4(),
        session_id="sent",
        header=SessionStreamHeaderEdit(name="Renamed"),
        access=OWNERLESS_PROJECT_POLICY,
        envelope=make_envelope(origin="web"),
    )

    stream = await dao.get_by_session_id(project_id=_PROJECT, session_id="sent")
    assert stream.name == "Renamed"
    assert stream.origin == SessionOrigin.api

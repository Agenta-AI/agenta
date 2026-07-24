"""WP2 (S1/S8): the session header (name/description) lives on the stream row.

Covers:
  - the header edit (rename) persists through the DAO mapping and round-trips
    via the DBE->DTO mapping (no live DB — mirrors test_records_mapping_upsert.py's
    style);
  - a heartbeat / flag-mirror write (`SessionStreamEdit`, used by heartbeat/
    detach/kill/_start_turn/_mirror_flags) never carries name/description, so it
    cannot clobber a prior rename — the stated guard against write amplification;
  - flags still mirror the Redis nest through a heartbeat, unaffected by the
    header columns being present on the same row.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamEdit,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_header_edit,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_header_merge"


def _dbe(**over) -> SessionStreamDBE:
    base = dict(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        name=None,
        description=None,
        flags=None,
        tags=None,
        meta=None,
        turn_id=None,
    )
    base.update(over)
    return SessionStreamDBE(**base)


# ---------------------------------------------------------------------------
# Mapping-level: the header edit only ever touches name/description.
# ---------------------------------------------------------------------------


def test_header_edit_sets_name_and_description():
    dbe = _dbe()

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=SessionStreamHeaderEdit(name="My Session", description="a desc"),
    )

    assert dbe.name == "My Session"
    assert dbe.description == "a desc"


def test_header_edit_partial_field_preserves_the_other():
    # A rename PUT that sends only `name` must not null `description` (full-PUT
    # semantics here means "PUT the header fields you own", not "PUT everything or
    # get nulled" -- exclude_unset upstream keeps the unsent field out of the DTO).
    dbe = _dbe(name="Old Name", description="Old description")

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=SessionStreamHeaderEdit(name="New Name"),
    )

    assert dbe.name == "New Name"
    assert dbe.description == "Old description"


def test_header_edit_does_not_touch_flags_or_turn_id():
    dbe = _dbe(flags={"is_alive": True, "is_running": True}, turn_id="turn-1")

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=SessionStreamHeaderEdit(name="Renamed"),
    )

    assert dbe.flags == {"is_alive": True, "is_running": True}
    assert dbe.turn_id == "turn-1"


def test_dbe_to_dto_round_trips_header_fields():
    dbe = _dbe(name="Round Trip", description="round trip desc")

    dto = map_stream_dbe_to_dto(stream_dbe=dbe)

    assert dto.name == "Round Trip"
    assert dto.description == "round trip desc"


def test_flags_only_edit_never_carries_header_fields():
    # SessionStreamEdit (the DTO every flag-mirror write uses) has name/description
    # fields for symmetry, but a flag-only construction must leave them unset --
    # so a heartbeat that builds SessionStreamEdit(flags=...) alone cannot clobber
    # a prior rename even if some future edit accidentally forwarded model_dump().
    edit = SessionStreamEdit(flags=None)
    dumped = edit.model_dump(exclude_unset=True)
    assert "name" not in dumped
    assert "description" not in dumped


# ---------------------------------------------------------------------------
# Service-level: heartbeat/flag-mirror paths never clobber name/description;
# flags still mirror the nest.
# ---------------------------------------------------------------------------


class _FakeStreamsDAO:
    """Records every write's fields so a test can assert what a heartbeat touches.

    Mimics the real DAO's create/update contract but keeps a single in-memory row,
    including name/description, so a rename set once must survive later flag-only
    writes coming from the service (heartbeat/detach/kill/_mirror_flags).
    """

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.creates = 0
        self.updates = 0
        self.header_updates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        kwargs = dict(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            name=stream.name,
            description=stream.description,
            turn_id=stream.turn_id,
        )
        if stream.flags is not None:
            kwargs["flags"] = stream.flags
        self.row = SessionStream(**kwargs)
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        # Mirror the real DAO's partial-update semantics: only overwrite a field
        # when the edit actually sets it.
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            name=stream.name
            if stream.name is not None
            else (prior.name if prior else None),
            description=(
                stream.description
                if stream.description is not None
                else (prior.description if prior else None)
            ),
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
        )
        return self.row

    async def update_header(self, *, project_id, user_id, session_id, header):
        # Mirrors the real DAO: a select-then-update against a missing row returns
        # None rather than creating one — the service's set_header falls back to
        # `create` for that case.
        if self.row is None:
            return None
        self.header_updates += 1
        prior = self.row
        self.row = SessionStream(
            id=prior.id,
            project_id=project_id,
            session_id=session_id,
            name=header.name if header.name is not None else prior.name,
            description=(
                header.description
                if header.description is not None
                else prior.description
            ),
            turn_id=prior.turn_id,
            flags=prior.flags,
        )
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(lock_engine, dao):
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


def _beat(replica: str, turn: str, running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, turn_id=turn, is_running=running
    )


@pytest.mark.asyncio
async def test_rename_survives_a_heartbeat_flag_mirror(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    # Rename first (the header edit).
    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Keep Me", description="stays put"),
    )
    assert dao.row.name == "Keep Me"

    # A heartbeat comes in and mirrors flags/turn_id -- it must not touch the header.
    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-a")
    )

    assert result.stream.name == "Keep Me"
    assert result.stream.description == "stays put"
    assert dao.row.name == "Keep Me"
    assert dao.row.description == "stays put"


@pytest.mark.asyncio
async def test_heartbeat_still_mirrors_the_nest_flags(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-a")
    )

    assert result.stream.flags.is_alive is True
    assert result.stream.flags.is_running is True
    assert dao.creates == 1


@pytest.mark.asyncio
async def test_detach_flag_mirror_does_not_touch_header(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Named Before Detach"),
    )
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))

    await svc.detach(
        project_id=_PROJECT, user_id=None, session_id=_SESSION, watcher_id="w-1"
    )

    assert dao.row.name == "Named Before Detach"


@pytest.mark.asyncio
async def test_kill_flag_mirror_does_not_touch_header(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Named Before Kill"),
    )
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))

    await svc.kill(project_id=_PROJECT, user_id=None, session_id=_SESSION)

    assert dao.row.name == "Named Before Kill"


@pytest.mark.asyncio
async def test_set_header_never_calls_the_flags_update_path(lock_engine):
    dao = _FakeStreamsDAO(
        existing=SessionStream(
            id=uuid4(), project_id=_PROJECT, session_id=_SESSION, name="X"
        )
    )
    svc = _service(lock_engine, dao)

    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Y"),
    )

    assert dao.header_updates == 1
    assert dao.updates == 0
    assert dao.creates == 0


@pytest.mark.asyncio
async def test_rename_before_any_turn_creates_the_row(lock_engine):
    # A caller may name a session before it has ever heartbeat/run -- update_header
    # finds no row (mirrors the real DAO's select-then-None), so set_header falls
    # back to create.
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    stream = await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Named Pre-Turn"),
    )

    assert stream.name == "Named Pre-Turn"
    assert dao.creates == 1
    assert dao.header_updates == 0


@pytest.mark.asyncio
async def test_rename_race_falls_back_to_header_update_on_concurrent_create(
    lock_engine,
):
    # A concurrent first-touch (e.g. a heartbeat) can win the create between
    # set_header's update_header miss and its own create call; the DAO surfaces
    # that as SessionStreamAlreadyExists, and set_header must retry as an update
    # rather than raising.
    from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists

    class _RacyDAO(_FakeStreamsDAO):
        async def create(self, *, project_id, user_id, stream):
            self.row = SessionStream(
                id=uuid4(),
                project_id=project_id,
                session_id=stream.session_id,
                name=None,
            )
            raise SessionStreamAlreadyExists(session_id=stream.session_id)

    dao = _RacyDAO()
    svc = _service(lock_engine, dao)

    stream = await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Won The Retry"),
    )

    assert stream.name == "Won The Retry"
    assert dao.header_updates == 1

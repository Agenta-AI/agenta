"""An automatic rename never replaces a name a person controls.

The agent decides a `rename_session` call's arguments at one moment and may run them at a
later one. An approval card parks the call, the person renames the session by hand while it
waits, and the deferred call then writes the name the agent chose before the rename. The
person's name is gone and the agent reports the stale one.

Nothing in the agent's own view separates a stale intent from a fresh one, so the row
answers instead: a header edit says where the name came from, and the row remembers whether
a person controls it. This module pins the three parts that make that hold — the rule, what
the row remembers, and the route — and, at the end, the sequences that break if any one of
them is subtly wrong.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import (
    SessionNameSource,
    SessionStream,
    SessionStreamCreate,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.naming import refuse_name_change
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionNameProtected
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    SESSION_NAME_SOURCE_TAG_KEY,
    decode_name_source,
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_create,
    map_stream_dto_to_dbe_header_edit,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_rename_guard"

_AGENT_NAME = "Permission test"
_PERSON_NAME = "QA-6657 parked rename"
_MANUAL_TAGS = {SESSION_NAME_SOURCE_TAG_KEY: "manual"}


def _edit(**over) -> SessionStreamHeaderEdit:
    return SessionStreamHeaderEdit(**over)


# ---------------------------------------------------------------------------
# The rule. A pure function over the row's state and the edit.
# ---------------------------------------------------------------------------


def _refuse(
    *,
    current_name: Optional[str] = _PERSON_NAME,
    current_source: Optional[SessionNameSource] = SessionNameSource.manual,
    name_source: SessionNameSource = SessionNameSource.automatic,
    **edit,
) -> None:
    refuse_name_change(
        session_id=_SESSION,
        current_name=current_name,
        current_source=current_source,
        header=_edit(**edit),
        name_source=name_source,
    )


def test_an_automatic_rename_over_a_person_name_is_refused():
    # The reported bug: the person renames while an approval card holds the agent's call,
    # and the deferred call runs with the name the agent chose before the rename.
    with pytest.raises(SessionNameProtected) as raised:
        _refuse(name=_AGENT_NAME)

    assert raised.value.current_name == _PERSON_NAME
    assert raised.value.code == "session_name_is_manual"
    assert raised.value.stale_precondition is False


def test_a_manual_rename_is_never_refused():
    _refuse(name="A second name", name_source=SessionNameSource.manual)


def test_an_edit_that_sets_no_name_is_never_refused():
    # The agent keeps the recap current on a session the person named.
    _refuse(description="ran the shell command")


def test_a_session_nobody_named_is_not_protected():
    _refuse(name=_AGENT_NAME, current_name=None, current_source=None)
    _refuse(name=_AGENT_NAME, current_name="", current_source=None)


def test_a_name_no_person_chose_is_not_protected():
    # The browser's auto-title, and the agent's own earlier name. Both must be replaceable.
    _refuse(name=_AGENT_NAME, current_source=None)
    _refuse(name=_AGENT_NAME, current_source=SessionNameSource.automatic)


def test_the_same_name_is_not_an_overwrite():
    # A retry of a call that already landed changes nothing, so refusing it would teach the
    # agent that a correct call failed. Padding is trimmed at the DTO, so this compares equal.
    _refuse(name=f"  {_PERSON_NAME}  ")


def test_naming_the_replaced_name_passes():
    # "Rename this session to X", asked for while the session is still called what the
    # agent read.
    _refuse(name="A name the person asked for", replacing_name=_PERSON_NAME)


def test_a_stale_replacing_name_is_refused_with_the_current_name():
    # The person asked for a rename, then renamed the session again themselves. The old
    # request was for a name that is no longer there, so it must not take effect now.
    with pytest.raises(SessionNameProtected) as raised:
        _refuse(name="A name the person asked for", replacing_name="An older name")

    assert raised.value.current_name == _PERSON_NAME
    assert raised.value.code == "session_name_changed"
    assert raised.value.stale_precondition is True


def test_the_refusal_envelope_carries_the_name_and_one_next_step():
    envelope = SessionNameProtected(_SESSION, _PERSON_NAME).envelope()

    assert envelope["code"] == "session_name_is_manual"
    assert envelope["retryable"] is False
    assert envelope["details"] == {"current_name": _PERSON_NAME}
    assert _PERSON_NAME in envelope["message"]
    assert "replacing_name" in envelope["next_step"]


def test_a_padded_name_is_trimmed_before_it_is_stored():
    assert _edit(name="  Padded  ").name == "Padded"
    assert _edit(replacing_name="  Padded  ").replacing_name == "Padded"
    assert _edit(name="").name == ""
    with pytest.raises(ValueError):
        _edit(name="   ")


# ---------------------------------------------------------------------------
# What the row remembers. Only a manual edit ever moves the stamp.
# ---------------------------------------------------------------------------


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


def _apply(
    dbe: SessionStreamDBE, source: SessionNameSource, **edit
) -> SessionStreamDBE:
    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(**edit),
        name_source=source,
    )
    return dbe


def test_a_person_rename_stamps_the_row():
    dbe = _apply(_dbe(name=_AGENT_NAME), SessionNameSource.manual, name=_PERSON_NAME)

    assert dbe.name == _PERSON_NAME
    assert dbe.tags == _MANUAL_TAGS
    assert decode_name_source(dbe.tags) is SessionNameSource.manual


def test_an_automatic_rename_never_moves_the_stamp():
    # THE bug an earlier draft of this guard had. The agent repeats the name the person
    # typed, the rule lets that through as a no-op, and if the write cleared the stamp the
    # very next automatic rename would replace the person's name. Nothing about an automatic
    # edit may weaken the row.
    dbe = _apply(
        _dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)),
        SessionNameSource.automatic,
        name=_PERSON_NAME,
    )

    assert dbe.name == _PERSON_NAME
    assert decode_name_source(dbe.tags) is SessionNameSource.manual


def test_a_rename_the_person_asked_for_keeps_the_stamp():
    # The name still originates from the person, so they keep control of it.
    dbe = _apply(
        _dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)),
        SessionNameSource.automatic,
        name="A name the person asked for",
        replacing_name=_PERSON_NAME,
    )

    assert dbe.name == "A name the person asked for"
    assert decode_name_source(dbe.tags) is SessionNameSource.manual


def test_an_automatic_rename_of_an_unstamped_row_stays_unstamped():
    dbe = _apply(_dbe(name="auto title"), SessionNameSource.automatic, name=_AGENT_NAME)

    assert dbe.name == _AGENT_NAME
    assert dbe.tags is None


def test_a_description_only_edit_leaves_the_stamp_alone():
    dbe = _apply(
        _dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)),
        SessionNameSource.automatic,
        description="a fresh recap",
    )

    assert dbe.name == _PERSON_NAME
    assert dbe.tags == _MANUAL_TAGS


def test_clearing_the_title_removes_the_stamp():
    # An empty name is the chat rail's clear action. A row with no name has no source.
    dbe = _apply(
        _dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)),
        SessionNameSource.manual,
        name="",
    )

    assert dbe.name == ""
    assert dbe.tags is None


def test_the_stamp_keeps_the_caller_owned_tags():
    dbe = _apply(
        _dbe(name=_AGENT_NAME, tags={"team": "support"}),
        SessionNameSource.manual,
        name=_PERSON_NAME,
    )

    assert dbe.tags == {"team": "support", **_MANUAL_TAGS}


def test_a_create_carries_the_stamp():
    # A person may name a session before its first turn, so the create path stamps too.
    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(
            session_id=_SESSION,
            name=_PERSON_NAME,
            name_source=SessionNameSource.manual,
        ),
    )

    assert dbe.tags == _MANUAL_TAGS


def test_a_create_from_an_automatic_caller_is_unstamped():
    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(
            session_id=_SESSION,
            name=_AGENT_NAME,
            name_source=SessionNameSource.automatic,
        ),
    )

    assert dbe.tags is None


def test_the_stamp_never_reaches_a_client():
    # `ag.` is the reserved namespace, so the read mapper strips it like every other one,
    # and no decoded copy rides out on the response either.
    dto = map_stream_dbe_to_dto(
        stream_dbe=_dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS))
    )

    assert dto.tags is None
    assert "name_source" not in dto.model_dump()


def test_a_junk_stamp_reads_as_no_source():
    # This decides whether a rename is refused. An unparseable row must not fail the read.
    assert decode_name_source({SESSION_NAME_SOURCE_TAG_KEY: 7}) is None
    assert decode_name_source({SESSION_NAME_SOURCE_TAG_KEY: "nonsense"}) is None
    assert decode_name_source(["not", "a", "dict"]) is None
    assert decode_name_source(None) is None


# ---------------------------------------------------------------------------
# The service. The guard decides against the row the write locks, not an earlier read.
# ---------------------------------------------------------------------------


class _FakeStreamsDAO:
    """One in-memory row that applies the real rule and the real mapper.

    `stale_view` is what makes the interleaving test meaningful: it is the row a caller
    would have read a moment ago, while `row` is what the write actually locks. A guard
    that ran a layer up would read the stale one and let the write through.
    """

    def __init__(
        self,
        existing: Optional[SessionStreamDBE] = None,
        *,
        stale_view: Optional[SessionStreamDBE] = None,
    ) -> None:
        self.row = existing
        self.stale_view = stale_view
        self.created: list = []
        self.reads = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        self.reads += 1
        seen = self.stale_view if self.stale_view is not None else self.row
        return map_stream_dbe_to_dto(stream_dbe=seen) if seen is not None else None

    async def create(self, *, project_id, user_id, stream):
        self.created.append(stream)
        self.row = map_stream_dto_to_dbe_create(
            project_id=project_id, user_id=user_id, stream=stream
        )
        return map_stream_dbe_to_dto(stream_dbe=self.row)

    async def update_header(
        self,
        *,
        project_id,
        user_id,
        session_id,
        header,
        name_source=SessionNameSource.manual,
    ):
        if self.row is None:
            return None
        # The real DAO locks the row and then decides. Mirror that order, so a test that
        # hands in a stale view proves the decision ignores it.
        refuse_name_change(
            session_id=session_id,
            current_name=self.row.name,
            current_source=decode_name_source(self.row.tags),
            header=header,
            name_source=name_source,
        )
        map_stream_dto_to_dbe_header_edit(
            stream_dbe=self.row,
            user_id=user_id,
            header=header,
            name_source=name_source,
        )
        return map_stream_dbe_to_dto(stream_dbe=self.row)


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_FakeRedis()):
        yield engine


def _service(lock_engine, dao) -> SessionStreamsService:
    # No watch publisher: `_publish_changed` no-ops without one.
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


async def _rename(service, *, name, source, replacing=None):
    return await service.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=_edit(name=name, replacing_name=replacing),
        name_source=source,
    )


@pytest.mark.asyncio
async def test_the_service_never_reads_the_row_before_it_writes(lock_engine):
    # The read-then-write this guard must not have. A person's rename committing between a
    # pre-read and the write would replace a name that did not exist when it was checked.
    dao = _FakeStreamsDAO(_dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)))
    service = _service(lock_engine, dao)

    with pytest.raises(SessionNameProtected):
        await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert dao.reads == 0


@pytest.mark.asyncio
async def test_a_rename_committed_after_the_callers_read_is_not_overwritten(
    lock_engine,
):
    # The interleaving. The caller saw a session nobody had named; by the time the write
    # runs, a person owns the name. The write is decided on the row it locks, so it refuses.
    dao = _FakeStreamsDAO(
        _dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)),
        stale_view=_dbe(name="auto title"),
    )
    service = _service(lock_engine, dao)

    with pytest.raises(SessionNameProtected) as raised:
        await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert raised.value.current_name == _PERSON_NAME
    assert dao.row.name == _PERSON_NAME


@pytest.mark.asyncio
async def test_an_automatic_rename_applies_when_no_person_named_it(lock_engine):
    # The browser's auto-title from a first message. The agent renames over it every run.
    dao = _FakeStreamsDAO(_dbe(name="Create a file and run a command"))
    service = _service(lock_engine, dao)

    await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert dao.row.name == _AGENT_NAME
    assert decode_name_source(dao.row.tags) is None


@pytest.mark.asyncio
async def test_two_agent_renames_in_a_row_both_apply(lock_engine):
    dao = _FakeStreamsDAO(_dbe(name=None))
    service = _service(lock_engine, dao)

    await _rename(service, name="First agent name", source=SessionNameSource.automatic)
    await _rename(service, name="Second agent name", source=SessionNameSource.automatic)

    assert dao.row.name == "Second agent name"


@pytest.mark.asyncio
async def test_a_person_rename_is_never_guarded(lock_engine):
    dao = _FakeStreamsDAO(_dbe(name=_PERSON_NAME, tags=dict(_MANUAL_TAGS)))
    service = _service(lock_engine, dao)

    await _rename(service, name="A second name", source=SessionNameSource.manual)

    assert dao.row.name == "A second name"
    assert decode_name_source(dao.row.tags) is SessionNameSource.manual


@pytest.mark.asyncio
async def test_a_first_person_rename_creates_a_stamped_row(lock_engine):
    dao = _FakeStreamsDAO(None)
    service = _service(lock_engine, dao)

    await _rename(service, name=_PERSON_NAME, source=SessionNameSource.manual)

    assert dao.created[0].name_source is SessionNameSource.manual
    assert decode_name_source(dao.row.tags) is SessionNameSource.manual


@pytest.mark.asyncio
async def test_an_automatic_rename_on_a_missing_row_is_not_refused(lock_engine):
    dao = _FakeStreamsDAO(None)
    service = _service(lock_engine, dao)

    await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert dao.row.tags is None
    assert dao.row.name == _AGENT_NAME


# ---------------------------------------------------------------------------
# The sequences. Each one breaks if a single transition above is subtly wrong.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repeating_a_person_name_does_not_open_the_door(lock_engine):
    # manual A -> automatic A with a new description -> automatic B must still be refused.
    dao = _FakeStreamsDAO(_dbe(name=None))
    service = _service(lock_engine, dao)

    await _rename(service, name=_PERSON_NAME, source=SessionNameSource.manual)
    await service.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=_edit(name=_PERSON_NAME, description="ran the shell command"),
        name_source=SessionNameSource.automatic,
    )

    with pytest.raises(SessionNameProtected):
        await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert dao.row.name == _PERSON_NAME
    assert dao.row.description == "ran the shell command"


@pytest.mark.asyncio
async def test_a_rename_the_person_asked_for_does_not_open_the_door(lock_engine):
    # manual A -> asked-for B -> ordinary automatic C must still be refused.
    dao = _FakeStreamsDAO(_dbe(name=None))
    service = _service(lock_engine, dao)

    await _rename(service, name=_PERSON_NAME, source=SessionNameSource.manual)
    await _rename(
        service,
        name="A name the person asked for",
        source=SessionNameSource.automatic,
        replacing=_PERSON_NAME,
    )

    with pytest.raises(SessionNameProtected):
        await _rename(service, name=_AGENT_NAME, source=SessionNameSource.automatic)

    assert dao.row.name == "A name the person asked for"


@pytest.mark.asyncio
async def test_a_pending_asked_for_rename_is_invalidated_by_a_newer_one(lock_engine):
    # The person asks for B while the session is called A, then renames it to C themselves.
    # Approving the old request must not resurrect B over C.
    dao = _FakeStreamsDAO(_dbe(name=None))
    service = _service(lock_engine, dao)

    await _rename(service, name=_PERSON_NAME, source=SessionNameSource.manual)
    await _rename(service, name="A newer name", source=SessionNameSource.manual)

    with pytest.raises(SessionNameProtected) as raised:
        await _rename(
            service,
            name="A name the person asked for",
            source=SessionNameSource.automatic,
            replacing=_PERSON_NAME,
        )

    assert raised.value.code == "session_name_changed"
    assert dao.row.name == "A newer name"


# ---------------------------------------------------------------------------
# The route: `name_source` is a query parameter, and the refusal reaches the model.
# ---------------------------------------------------------------------------


def _app(router) -> FastAPI:
    app = FastAPI()
    project_id = uuid4()
    user_id = uuid4()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = str(project_id)
        request.state.user_id = str(user_id)
        return await call_next(request)

    app.include_router(router.router)
    return app


def _client(service) -> TestClient:
    return TestClient(
        _app(SessionStreamsRouter(service=service, interactions_service=AsyncMock()))
    )


def _row(**over) -> SessionStream:
    base = dict(id=uuid4(), project_id=_PROJECT, session_id=_SESSION)
    base.update(over)
    return SessionStream(**base)


_HEADER_PATH = f"/sessions/streams/header?session_id={_SESSION}"


def test_the_route_defaults_to_a_person():
    # An unmarked caller — a script, a service on an older SDK mid-deploy — is read as a
    # person. That protects a name that maybe did not need it, rather than losing one.
    service = AsyncMock()
    service.set_header.return_value = _row(name=_PERSON_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).put(_HEADER_PATH, json={"name": _PERSON_NAME})

    assert response.status_code == 200
    assert (
        service.set_header.await_args.kwargs["name_source"] is SessionNameSource.manual
    )


def test_the_route_reads_the_source_from_the_query_string():
    # The rename tool's catalog path fixes `name_source=automatic`, which is why a model
    # filling only the body cannot claim a person chose its name.
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&name_source=automatic", json={"name": _AGENT_NAME}
        )

    assert response.status_code == 200
    assert (
        service.set_header.await_args.kwargs["name_source"]
        is SessionNameSource.automatic
    )


def test_a_body_name_source_cannot_reach_the_service():
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&name_source=automatic",
            json={"name": _AGENT_NAME, "name_source": "manual"},
        )

    assert response.status_code == 200
    assert (
        service.set_header.await_args.kwargs["name_source"]
        is SessionNameSource.automatic
    )


def test_a_refused_rename_answers_409_with_the_agent_actionable_envelope():
    service = AsyncMock()
    service.set_header.side_effect = SessionNameProtected(_SESSION, _PERSON_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&name_source=automatic", json={"name": _AGENT_NAME}
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "session_name_is_manual"
    assert detail["retryable"] is False
    assert detail["details"]["current_name"] == _PERSON_NAME
    assert "replacing_name" in detail["next_step"]


def test_the_route_forwards_the_replaced_name():
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&name_source=automatic",
            json={"name": _AGENT_NAME, "replacing_name": _PERSON_NAME},
        )

    assert response.status_code == 200
    assert service.set_header.await_args.kwargs["header"].replacing_name == _PERSON_NAME

"""An automatic rename never replaces a name a person typed.

The agent decides a `rename_session` call's arguments at one moment and may run them at a
later one. An approval card parks the call, the person renames the session by hand while it
waits, and the deferred call then writes the name the agent chose before the rename. The
person's name is gone and the agent reports the stale one.

Nothing in the agent's own view separates a stale intent from a fresh one, so the row answers
instead: a header edit says who chose the name, and the row remembers whether that was a
person. This module pins both halves — what the row remembers, and what the guard does with
it — plus the three cases that must still go through.
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
    SESSION_NAME_AUTHOR_TAG_KEY,
    SessionHeaderAuthor,
    SessionStream,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionNameProtected
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dbe_to_dto,
    map_stream_dto_to_dbe_header_edit,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_rename_guard"

_AGENT_NAME = "Permission test"
_PERSON_NAME = "QA-v0.115.3 parked rename"


# ---------------------------------------------------------------------------
# What the row remembers: the mapper stamps the author of the current name.
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


def _edit(**over) -> SessionStreamHeaderEdit:
    return SessionStreamHeaderEdit(**over)


def test_a_person_rename_stamps_the_row():
    dbe = _dbe(name=_AGENT_NAME)

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(name=_PERSON_NAME),
        author=SessionHeaderAuthor.user,
    )

    assert dbe.name == _PERSON_NAME
    assert dbe.tags == {SESSION_NAME_AUTHOR_TAG_KEY: "user"}
    assert map_stream_dbe_to_dto(stream_dbe=dbe).name_author is SessionHeaderAuthor.user


def test_an_automatic_rename_clears_the_stamp():
    # The agent's own name is not a person's, so the NEXT automatic rename must go through.
    dbe = _dbe(name=_PERSON_NAME, tags={SESSION_NAME_AUTHOR_TAG_KEY: "user"})

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(name=_AGENT_NAME),
        author=SessionHeaderAuthor.auto,
    )

    assert dbe.name == _AGENT_NAME
    assert dbe.tags is None
    assert map_stream_dbe_to_dto(stream_dbe=dbe).name_author is None


def test_a_description_only_edit_leaves_the_stamp_alone():
    dbe = _dbe(name=_PERSON_NAME, tags={SESSION_NAME_AUTHOR_TAG_KEY: "user"})

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(description="a fresh recap"),
        author=SessionHeaderAuthor.auto,
    )

    assert dbe.name == _PERSON_NAME
    assert dbe.tags == {SESSION_NAME_AUTHOR_TAG_KEY: "user"}


def test_clearing_the_title_removes_the_stamp():
    # An empty name is the chat rail's clear action. A row with no name has no author.
    dbe = _dbe(name=_PERSON_NAME, tags={SESSION_NAME_AUTHOR_TAG_KEY: "user"})

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(name=""),
        author=SessionHeaderAuthor.user,
    )

    assert dbe.name == ""
    assert dbe.tags is None


def test_the_stamp_keeps_the_caller_owned_tags():
    dbe = _dbe(name=_AGENT_NAME, tags={"team": "support"})

    map_stream_dto_to_dbe_header_edit(
        stream_dbe=dbe,
        user_id=None,
        header=_edit(name=_PERSON_NAME),
        author=SessionHeaderAuthor.user,
    )

    assert dbe.tags == {"team": "support", SESSION_NAME_AUTHOR_TAG_KEY: "user"}


def test_the_stamp_never_reaches_a_client():
    # `ag.` is the reserved namespace, so the read mapper strips it like every other one.
    dbe = _dbe(name=_PERSON_NAME, tags={SESSION_NAME_AUTHOR_TAG_KEY: "user"})

    assert map_stream_dbe_to_dto(stream_dbe=dbe).tags is None


def test_a_junk_stamp_reads_as_no_author():
    # This decides whether a rename is refused. An unparseable row must not fail the read.
    dbe = _dbe(name=_PERSON_NAME, tags={SESSION_NAME_AUTHOR_TAG_KEY: 7})

    assert map_stream_dbe_to_dto(stream_dbe=dbe).name_author is None


# ---------------------------------------------------------------------------
# What the guard does with it, at the service.
# ---------------------------------------------------------------------------


class _FakeStreamsDAO:
    """One in-memory row with the real DAO's header contract, stamp included."""

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.created: list = []

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.created.append(stream)
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            name=stream.name,
            description=stream.description,
            name_author=(
                SessionHeaderAuthor(
                    (stream.tags or {}).get(SESSION_NAME_AUTHOR_TAG_KEY)
                )
                if (stream.tags or {}).get(SESSION_NAME_AUTHOR_TAG_KEY)
                else None
            ),
        )
        return self.row

    async def update_header(
        self,
        *,
        project_id,
        user_id,
        session_id,
        header,
        author=SessionHeaderAuthor.user,
    ):
        if self.row is None:
            return None
        prior = self.row
        update = {
            "name": header.name if header.name is not None else prior.name,
            "description": header.description
            if header.description is not None
            else prior.description,
        }
        if header.name is not None:
            update["name_author"] = (
                SessionHeaderAuthor.user
                if author is SessionHeaderAuthor.user and header.name.strip()
                else None
            )
        self.row = prior.model_copy(update=update)
        return self.row


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_FakeRedis()):
        yield engine


def _row(**over) -> SessionStream:
    base = dict(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
    )
    base.update(over)
    return SessionStream(**base)


def _service(lock_engine, dao) -> SessionStreamsService:
    # No watch publisher: `_publish_changed` no-ops without one.
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


async def _rename(service, *, name, author, override=False):
    return await service.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=_edit(name=name, override_user_name=override),
        author=author,
    )


@pytest.mark.asyncio
async def test_an_automatic_rename_over_a_person_name_is_refused(lock_engine):
    # The reported bug: the person renames while an approval card holds the agent's call,
    # and the deferred call runs with the name the agent chose before the rename.
    dao = _FakeStreamsDAO(
        _row(name=_PERSON_NAME, name_author=SessionHeaderAuthor.user),
    )
    service = _service(lock_engine, dao)

    with pytest.raises(SessionNameProtected) as raised:
        await _rename(service, name=_AGENT_NAME, author=SessionHeaderAuthor.auto)

    assert raised.value.current_name == _PERSON_NAME
    # The agent has to be able to adopt the name, so the message carries it.
    assert _PERSON_NAME in raised.value.message
    assert dao.row.name == _PERSON_NAME


@pytest.mark.asyncio
async def test_an_automatic_rename_applies_when_no_person_named_it(lock_engine):
    # The browser's auto-title from a first message. The agent renames over it every run.
    dao = _FakeStreamsDAO(_row(name="Create a file and run a command"))
    service = _service(lock_engine, dao)

    await _rename(service, name=_AGENT_NAME, author=SessionHeaderAuthor.auto)

    assert dao.row.name == _AGENT_NAME
    assert dao.row.name_author is None


@pytest.mark.asyncio
async def test_two_agent_renames_in_a_row_both_apply(lock_engine):
    dao = _FakeStreamsDAO(_row(name=None))
    service = _service(lock_engine, dao)

    await _rename(service, name="First agent name", author=SessionHeaderAuthor.auto)
    await _rename(service, name="Second agent name", author=SessionHeaderAuthor.auto)

    assert dao.row.name == "Second agent name"


@pytest.mark.asyncio
async def test_a_person_rename_is_never_guarded(lock_engine):
    dao = _FakeStreamsDAO(
        _row(name=_PERSON_NAME, name_author=SessionHeaderAuthor.user),
    )
    service = _service(lock_engine, dao)

    await _rename(service, name="A second name", author=SessionHeaderAuthor.user)

    assert dao.row.name == "A second name"
    assert dao.row.name_author is SessionHeaderAuthor.user


@pytest.mark.asyncio
async def test_the_override_lets_a_requested_rename_through(lock_engine):
    # "Rename this session to X" is a supported request. The refusal tells the agent how.
    dao = _FakeStreamsDAO(
        _row(name=_PERSON_NAME, name_author=SessionHeaderAuthor.user),
    )
    service = _service(lock_engine, dao)

    await _rename(
        service,
        name="A name the person asked for",
        author=SessionHeaderAuthor.auto,
        override=True,
    )

    assert dao.row.name == "A name the person asked for"


@pytest.mark.asyncio
async def test_the_same_name_is_not_an_overwrite(lock_engine):
    # A retry of a call that already landed changes nothing, so refusing it teaches the
    # agent that a correct call failed.
    dao = _FakeStreamsDAO(
        _row(name=_PERSON_NAME, name_author=SessionHeaderAuthor.user),
    )
    service = _service(lock_engine, dao)

    await _rename(service, name=f"  {_PERSON_NAME}  ", author=SessionHeaderAuthor.auto)

    assert dao.row.name.strip() == _PERSON_NAME


@pytest.mark.asyncio
async def test_a_description_only_edit_is_not_guarded(lock_engine):
    # The agent keeps the recap current on a session the person named.
    dao = _FakeStreamsDAO(
        _row(name=_PERSON_NAME, name_author=SessionHeaderAuthor.user),
    )
    service = _service(lock_engine, dao)

    await service.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=_edit(description="ran the shell command"),
        author=SessionHeaderAuthor.auto,
    )

    assert dao.row.name == _PERSON_NAME
    assert dao.row.description == "ran the shell command"


@pytest.mark.asyncio
async def test_a_first_person_rename_creates_a_stamped_row(lock_engine):
    # A person may name a session before its first turn, so the create path stamps too.
    dao = _FakeStreamsDAO(None)
    service = _service(lock_engine, dao)

    await _rename(service, name=_PERSON_NAME, author=SessionHeaderAuthor.user)

    assert dao.created[0].tags == {SESSION_NAME_AUTHOR_TAG_KEY: "user"}
    assert dao.row.name_author is SessionHeaderAuthor.user


@pytest.mark.asyncio
async def test_an_automatic_rename_on_a_missing_row_is_not_refused(lock_engine):
    dao = _FakeStreamsDAO(None)
    service = _service(lock_engine, dao)

    await _rename(service, name=_AGENT_NAME, author=SessionHeaderAuthor.auto)

    assert dao.created[0].tags is None
    assert dao.row.name == _AGENT_NAME


# ---------------------------------------------------------------------------
# The route: `author` is a query parameter, and the refusal reaches the model.
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
        _app(
            SessionStreamsRouter(
                service=service,
                interactions_service=AsyncMock(),
            )
        )
    )


_HEADER_PATH = f"/sessions/streams/header?session_id={_SESSION}"


def test_the_route_defaults_to_a_person():
    # An unmarked caller — a script, an older SDK — is read as a person, which is the safe
    # side: a name gets protected that maybe did not need to be.
    service = AsyncMock()
    service.set_header.return_value = _row(name=_PERSON_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).put(_HEADER_PATH, json={"name": _PERSON_NAME})

    assert response.status_code == 200
    assert service.set_header.await_args.kwargs["author"] is SessionHeaderAuthor.user


def test_the_route_reads_the_author_from_the_query_string():
    # The rename tool's catalog path fixes `author=auto`, which is why a model filling only
    # the body cannot claim a person chose its name.
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&author=auto",
            json={"name": _AGENT_NAME},
        )

    assert response.status_code == 200
    assert service.set_header.await_args.kwargs["author"] is SessionHeaderAuthor.auto


def test_a_body_author_cannot_reach_the_service():
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&author=auto",
            json={"name": _AGENT_NAME, "author": "user"},
        )

    assert response.status_code == 200
    assert service.set_header.await_args.kwargs["author"] is SessionHeaderAuthor.auto


def test_a_refused_rename_answers_409_with_the_current_name():
    # The runner hands a string `detail` to the model verbatim, so the name has to be in it.
    service = AsyncMock()
    service.set_header.side_effect = SessionNameProtected(_SESSION, _PERSON_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&author=auto",
            json={"name": _AGENT_NAME},
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert isinstance(detail, str)
    assert _PERSON_NAME in detail
    assert "override_user_name" in detail


def test_the_route_forwards_the_override():
    service = AsyncMock()
    service.set_header.return_value = _row(name=_AGENT_NAME)

    with patch(
        "oss.src.apis.fastapi.sessions.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        response = _client(service).post(
            f"{_HEADER_PATH}&author=auto",
            json={"name": _AGENT_NAME, "override_user_name": True},
        )

    assert response.status_code == 200
    assert service.set_header.await_args.kwargs["header"].override_user_name is True

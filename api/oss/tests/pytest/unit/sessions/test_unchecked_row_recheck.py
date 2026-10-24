"""A row the route did not check is checked before a write touches it (M3 gate, Codex
spec check finding 1).

The header and command routes check the session, and a missing row passes (the write
creates it). When a concurrent request creates the row after that check (for example
another member's private chat with the same id), the write must not rename it, take
its locks, displace its turns or report its liveness before the route's check ran on
the winning row. The routes pass that check as `recheck`; the resource check records
in the request memo that it found no row.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.access.context import _request_memo
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionStreamAlreadyExists
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.sharing.service import _note_missing_session, session_was_missing
from oss.src.dbs.redis.sessions.contract import alive_key, running_key
from unit.sessions.test_project_scoped_locks import _FakeRedis

_PROJECT = uuid4()
_ALICE = uuid4()
_BOB = uuid4()
_PRIVATE_BOB = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=_BOB)


class _Hidden(Exception):
    """What the route's recheck raises for a hidden row (the not-found answer)."""


class _RacingDAO:
    """A DAO whose row appears from a concurrent request: `appear_after_gets` reads
    see no row, then Alice's private row exists (a create conflicts with it)."""

    def __init__(self, *, appear_after_gets: int, create_conflicts: bool = True):
        self.appear_after_gets = appear_after_gets
        self.create_conflicts = create_conflicts
        self.gets = 0
        self.row = None
        self.created = []
        self.updates = []
        self.header_updates = 0

    def _alice_row(self, session_id):
        return SessionStream(
            id=uuid4(),
            project_id=_PROJECT,
            session_id=session_id,
            visibility=Visibility.PRIVATE,
            owner_user_id=_ALICE,
        )

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        self.gets += 1
        if self.row is None and self.gets > self.appear_after_gets:
            self.row = self._alice_row(session_id)
        return self.row

    async def create(self, *, project_id, user_id, stream):
        if not self.create_conflicts and self.row is None:
            self.created.append(stream)
            self.row = SessionStream(
                id=uuid4(),
                project_id=project_id,
                session_id=stream.session_id,
                visibility=stream.access.visibility,
                owner_user_id=stream.access.owner_user_id,
            )
            return self.row
        if self.row is None:
            # The concurrent request commits first: this insert conflicts.
            self.row = self._alice_row(stream.session_id)
        raise SessionStreamAlreadyExists(stream.session_id)

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates.append(stream)
        return self.row

    async def update_header(self, *, project_id, user_id, session_id, header, **kw):
        self.header_updates += 1
        return self.row

    async def fill_missing(self, **kwargs):
        return self.row

    async def clear_archived_by_session_id(self, **kwargs):
        return self.row

    async def unarchive_by_session_id(self, **kwargs):
        return self.row


@pytest.fixture(autouse=True)
def _registered_sharing_service(monkeypatch):
    from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests

    return register_sharing_service_for_tests(monkeypatch)


@pytest.fixture
def request_memo():
    token = _request_memo.set({})
    yield
    _request_memo.reset(token)


@pytest_asyncio.fixture
async def redis():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    fake = _FakeRedis()
    with patch.object(engine, "_client", return_value=fake):
        yield engine, fake


def _service(dao, engine) -> SessionStreamsService:
    service = SessionStreamsService(streams_dao=dao, lock_engine=engine)
    service._publish_changed = AsyncMock()
    service._publish_lifecycle = AsyncMock()
    return service


def _refusing_recheck():
    recheck = AsyncMock(side_effect=_Hidden())
    return recheck


def test_the_missing_mark_lives_in_the_request_memo(request_memo):
    assert not session_was_missing(project_id=_PROJECT, session_id="s")
    _note_missing_session(project_id=_PROJECT, session_id="s")
    assert session_was_missing(project_id=_PROJECT, session_id="s")
    assert not session_was_missing(project_id=_PROJECT, session_id="other")


def test_no_request_memo_means_never_missing():
    _note_missing_session(project_id=_PROJECT, session_id="s")
    assert not session_was_missing(project_id=_PROJECT, session_id="s")


# -- set_header ---------------------------------------------------------------------------


@pytest.mark.parametrize("appear_after_gets", [0, 1])
async def test_header_create_race_checks_the_winning_row(
    redis, request_memo, appear_after_gets
):
    engine, _ = redis
    dao = _RacingDAO(appear_after_gets=appear_after_gets)
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s1")
    recheck = _refusing_recheck()

    with pytest.raises(_Hidden):
        await service.set_header(
            project_id=_PROJECT,
            user_id=_BOB,
            session_id="s1",
            header=SessionStreamHeaderEdit(name="Bob's name"),
            access=_PRIVATE_BOB,
            recheck=recheck,
        )
    recheck.assert_awaited_once()
    assert dao.header_updates == 0  # Alice's private row was never renamed
    service._publish_changed.assert_not_awaited()


async def test_header_on_a_checked_existing_row_never_rechecks(redis, request_memo):
    engine, _ = redis
    dao = _RacingDAO(appear_after_gets=0)
    dao.row = dao._alice_row("s2")
    service = _service(dao, engine)
    recheck = _refusing_recheck()

    await service.set_header(
        project_id=_PROJECT,
        user_id=_ALICE,
        session_id="s2",
        header=SessionStreamHeaderEdit(name="Renamed"),
        access=_PRIVATE_BOB,
        recheck=recheck,
    )
    recheck.assert_not_awaited()
    assert dao.header_updates == 1


# -- command / _start_turn ----------------------------------------------------------------


async def test_send_to_a_row_created_after_the_check_is_checked_before_any_lock(
    redis, request_memo
):
    engine, fake = redis
    dao = _RacingDAO(appear_after_gets=0)  # the row exists by the time the send runs
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s3")
    recheck = _refusing_recheck()

    with pytest.raises(_Hidden):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(
                session_id="s3", data={"inputs": {"messages": []}}
            ),
            access=_PRIVATE_BOB,
            arrived_at_ms=1,
            recheck=recheck,
        )
    recheck.assert_awaited_once()
    assert await fake.get(alive_key(str(_PROJECT), "s3")) is None
    assert await fake.get(running_key(str(_PROJECT), "s3")) is None
    assert dao.updates == []


async def test_start_turn_create_race_checks_the_winner_and_hands_back_the_locks(
    redis, request_memo
):
    engine, fake = redis
    # No row at the command's read nor at _start_turn's read; the create conflicts.
    dao = _RacingDAO(appear_after_gets=10)
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s4")
    recheck = _refusing_recheck()

    with pytest.raises(_Hidden):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(
                session_id="s4", data={"inputs": {"messages": []}}
            ),
            access=_PRIVATE_BOB,
            arrived_at_ms=1,
            recheck=recheck,
        )
    recheck.assert_awaited_once()
    assert dao.updates == []
    assert await fake.get(alive_key(str(_PROJECT), "s4")) is None
    assert await fake.get(running_key(str(_PROJECT), "s4")) is None


async def test_start_turn_row_appearing_between_reads_is_checked(redis, request_memo):
    engine, fake = redis
    # The command's read sees no row; _start_turn's read (after the locks) sees it.
    dao = _RacingDAO(appear_after_gets=1)
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s5")
    recheck = _refusing_recheck()

    with pytest.raises(_Hidden):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(
                session_id="s5", data={"inputs": {"messages": []}}
            ),
            access=_PRIVATE_BOB,
            arrived_at_ms=1,
            recheck=recheck,
        )
    assert dao.updates == []
    assert await fake.get(alive_key(str(_PROJECT), "s5")) is None


async def test_send_to_a_checked_existing_row_adds_no_read(redis, request_memo):
    engine, _ = redis
    dao = _RacingDAO(appear_after_gets=0)
    dao.row = dao._alice_row("s6")
    service = _service(dao, engine)
    recheck = _refusing_recheck()

    await service.command(
        project_id=_PROJECT,
        user_id=_ALICE,
        request=SessionStreamCommandRequest(
            session_id="s6", data={"inputs": {"messages": []}}
        ),
        access=_PRIVATE_BOB,
        arrived_at_ms=1,
        recheck=recheck,
    )
    recheck.assert_not_awaited()
    assert dao.gets == 1  # only _start_turn's own read, as before


async def _alice_turn_holds(fake, session_id, turn_id="alice-turn"):
    await fake.set(alive_key(str(_PROJECT), session_id), turn_id.encode())
    await fake.set(running_key(str(_PROJECT), session_id), turn_id.encode())


@pytest.mark.parametrize("data", [{"inputs": {"messages": []}}])
@pytest.mark.parametrize("force", [False, True])  # send, steer
async def test_a_live_private_session_created_after_the_check_is_not_disclosed_or_displaced(
    redis, request_memo, data, force
):
    """Codex re-check: Alice creates a private session and starts a turn right after
    Bob's check found no row. Bob's send must not answer with her liveness, and his steer
    must not displace her turn: creation is settled (and the winner checked) first."""
    engine, fake = redis
    # A read made right after the check still finds no row; Alice's row and live turn
    # exist by the time Bob's command goes on.
    dao = _RacingDAO(appear_after_gets=1)
    await _alice_turn_holds(fake, "s7")
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s7")
    recheck = _refusing_recheck()

    with pytest.raises(_Hidden):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(
                session_id="s7", data=data, force=force
            ),
            access=_PRIVATE_BOB,
            arrived_at_ms=1,
            recheck=recheck,
        )
    recheck.assert_awaited_once()
    # No SessionTurnInUse with Alice's liveness, and her turn is not displaced.
    assert await fake.get(alive_key(str(_PROJECT), "s7")) == b"alice-turn"
    assert await fake.get(running_key(str(_PROJECT), "s7")) == b"alice-turn"
    assert dao.updates == []


async def test_a_cancel_of_a_session_that_does_not_exist_cancels_nothing(
    redis, request_memo
):
    engine, fake = redis
    dao = _RacingDAO(appear_after_gets=10)
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s8")
    recheck = _refusing_recheck()

    response = await service.command(
        project_id=_PROJECT,
        user_id=_BOB,
        request=SessionStreamCommandRequest(session_id="s8"),
        access=_PRIVATE_BOB,
        arrived_at_ms=1,
        recheck=recheck,
    )
    assert response.cancelled_turn_ids == []
    recheck.assert_not_awaited()


async def test_a_cancel_racing_a_new_private_session_never_displaces_it(
    redis, request_memo
):
    """Alice's row and turn appear right after Bob's check found no row: Bob's cancel
    (whose read still sees no row) cancels nothing; a later cancel that sees the row is
    checked first."""
    engine, fake = redis
    dao = _RacingDAO(appear_after_gets=1)
    await _alice_turn_holds(fake, "s9")
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s9")
    recheck = _refusing_recheck()

    response = await service.command(
        project_id=_PROJECT,
        user_id=_BOB,
        request=SessionStreamCommandRequest(session_id="s9"),
        access=_PRIVATE_BOB,
        arrived_at_ms=1,
        recheck=recheck,
    )
    assert response.cancelled_turn_ids == []
    assert await fake.get(alive_key(str(_PROJECT), "s9")) == b"alice-turn"
    assert await fake.get(running_key(str(_PROJECT), "s9")) == b"alice-turn"

    with pytest.raises(_Hidden):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(session_id="s9"),
            access=_PRIVATE_BOB,
            arrived_at_ms=1,
            recheck=recheck,
        )
    assert await fake.get(alive_key(str(_PROJECT), "s9")) == b"alice-turn"


async def test_a_first_send_creates_its_row_before_the_locks_and_lists_it(
    redis, request_memo
):
    engine, fake = redis
    dao = _RacingDAO(appear_after_gets=10, create_conflicts=False)
    service = _service(dao, engine)
    _note_missing_session(project_id=_PROJECT, session_id="s10")
    recheck = _refusing_recheck()

    response = await service.command(
        project_id=_PROJECT,
        user_id=_BOB,
        request=SessionStreamCommandRequest(
            session_id="s10", data={"inputs": {"messages": []}}
        ),
        access=_PRIVATE_BOB,
        arrived_at_ms=1,
        recheck=recheck,
    )
    recheck.assert_not_awaited()
    assert [stream.access for stream in dao.created] == [_PRIVATE_BOB]
    assert dao.row.owner_user_id == _BOB
    assert await fake.get(alive_key(str(_PROJECT), "s10")) == response.turn_id.encode()
    service._publish_changed.assert_awaited()

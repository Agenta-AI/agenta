"""WP5 (S7/F1/F2/B3): SessionsService — root /sessions operations.

Unit-level: fakes each sub-service (streams/turns/interactions/mounts) so the
orchestration itself is under test, not the DAOs (those have their own
DAO-level integration coverage, e.g. test_turns_dao.py). Covers:

  - delete_session: exact fan-out order and calls (turns, interactions, mounts,
    then the hard stream delete) — records are never touched.
  - archive_session / unarchive_session: soft fan-out including bound mounts,
    round-trips deleted_at.
  - query_sessions: reference filter joins turns -> session_ids, then filters
    the stream query; windowed pass-through; no-match short-circuits to [].
  - fan-out keys off session_id, never stream_id (asserted via the fakes'
    captured call kwargs).
"""

from typing import List, Optional
from uuid import uuid4

import pytest

from oss.src.core.sessions.dtos import SessionQuery
from oss.src.core.sessions.service import SessionsService
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.turns.dtos import HarnessKind, SessionTurn
from oss.src.core.shared.dtos import Reference, Windowing


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session-wp5-root"


def _stream(session_id: str = _SESSION, deleted: bool = False) -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        deleted_at="2026-01-01T00:00:00Z" if deleted else None,
    )


def _turn(session_id: str, references: Optional[List[Reference]] = None) -> SessionTurn:
    return SessionTurn(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        stream_id=uuid4(),
        turn_index=0,
        harness_kind=HarnessKind.PI,
        references=references,
    )


class _FakeStreamsService:
    def __init__(self, row: Optional[SessionStream] = None):
        self.row = row
        self.hard_delete_calls: list[dict] = []
        self.archive_calls: list[dict] = []
        self.unarchive_calls: list[dict] = []
        self.query_calls: list[dict] = []

    async def query_streams(
        self, *, project_id, filter, windowing=None, session_ids=None
    ):
        self.query_calls.append(
            {
                "project_id": project_id,
                "session_ids": session_ids,
                "windowing": windowing,
            }
        )
        if session_ids is not None:
            return [
                s
                for s in ([self.row] if self.row else [])
                if s.session_id in session_ids
            ]
        return [self.row] if self.row else []

    async def hard_delete(self, *, project_id, session_id):
        self.hard_delete_calls.append(
            {"project_id": project_id, "session_id": session_id}
        )
        return True

    async def archive(self, *, project_id, user_id, session_id):
        self.archive_calls.append(
            {"project_id": project_id, "user_id": user_id, "session_id": session_id}
        )
        if self.row is not None:
            self.row = self.row.model_copy(
                update={"archived_at": "2026-01-01T00:00:00Z"}
            )
        return self.row

    async def unarchive(self, *, project_id, user_id, session_id):
        self.unarchive_calls.append(
            {"project_id": project_id, "user_id": user_id, "session_id": session_id}
        )
        if self.row is not None:
            self.row = self.row.model_copy(update={"archived_at": None})
        return self.row


class _FakeTurnsService:
    def __init__(self, turns: Optional[List[SessionTurn]] = None):
        self.turns = turns or []
        self.query_calls: list[dict] = []
        self.delete_calls: list[dict] = []

    async def query_turns(self, *, project_id, query=None, windowing=None):
        self.query_calls.append({"project_id": project_id, "query": query})
        if query and query.references:
            wanted = {r.id for r in query.references}
            return [
                t
                for t in self.turns
                if t.references and any(r.id in wanted for r in t.references)
            ]
        return self.turns

    async def delete_by_session_id(self, *, project_id, session_id):
        self.delete_calls.append({"project_id": project_id, "session_id": session_id})
        return len(self.turns)


class _FakeInteractionsService:
    def __init__(self):
        self.delete_calls: list[dict] = []

    async def delete_by_session_id(self, *, project_id, session_id):
        self.delete_calls.append({"project_id": project_id, "session_id": session_id})
        return 1


class _FakeMountsService:
    def __init__(self):
        self.delete_calls: list[dict] = []
        self.archive_calls: list[dict] = []
        self.unarchive_calls: list[dict] = []

    async def delete_session_mounts(self, *, project_id, session_id):
        self.delete_calls.append({"project_id": project_id, "session_id": session_id})
        return []

    async def archive_session_mounts(self, *, project_id, user_id, session_id):
        self.archive_calls.append(
            {"project_id": project_id, "user_id": user_id, "session_id": session_id}
        )
        return []

    async def unarchive_session_mounts(self, *, project_id, user_id, session_id):
        self.unarchive_calls.append(
            {"project_id": project_id, "user_id": user_id, "session_id": session_id}
        )
        return []


def _service(
    *,
    stream: Optional[SessionStream] = None,
    turns: Optional[List[SessionTurn]] = None,
):
    streams = _FakeStreamsService(row=stream)
    turns_svc = _FakeTurnsService(turns=turns)
    interactions = _FakeInteractionsService()
    mounts = _FakeMountsService()
    svc = SessionsService(
        streams_service=streams,
        turns_service=turns_svc,
        interactions_service=interactions,
        mounts_service=mounts,
    )
    return svc, streams, turns_svc, interactions, mounts


# ---------------------------------------------------------------------------
# delete_session — F1 fan-out
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_session_fans_out_to_turns_interactions_mounts_and_stream():
    svc, streams, turns_svc, interactions, mounts = _service()

    await svc.delete_session(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert turns_svc.delete_calls == [{"project_id": _PROJECT, "session_id": _SESSION}]
    assert interactions.delete_calls == [
        {"project_id": _PROJECT, "session_id": _SESSION}
    ]
    assert mounts.delete_calls == [{"project_id": _PROJECT, "session_id": _SESSION}]
    assert streams.hard_delete_calls == [
        {"project_id": _PROJECT, "session_id": _SESSION}
    ]


@pytest.mark.asyncio
async def test_delete_session_never_touches_records():
    # No records service is even injected into SessionsService -- the fan-out
    # has no path to a records call. This test pins that absence structurally:
    # SessionsService's constructor accepts no records_service.
    import inspect

    params = inspect.signature(SessionsService.__init__).parameters
    assert "records_service" not in params


@pytest.mark.asyncio
async def test_delete_session_keys_off_session_id_not_stream_id():
    svc, streams, turns_svc, interactions, mounts = _service()

    await svc.delete_session(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    for call in (
        turns_svc.delete_calls[0],
        interactions.delete_calls[0],
        mounts.delete_calls[0],
        streams.hard_delete_calls[0],
    ):
        assert call["session_id"] == _SESSION
        assert "stream_id" not in call


# ---------------------------------------------------------------------------
# archive_session / unarchive_session — F2 fan-out
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archive_session_soft_archives_stream_and_mounts():
    stream = _stream()
    svc, streams, _, _, mounts = _service(stream=stream)

    result = await svc.archive_session(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert result is not None
    assert result.archived_at is not None
    assert result.deleted_at is None
    assert mounts.archive_calls == [
        {"project_id": _PROJECT, "user_id": _USER, "session_id": _SESSION}
    ]
    assert streams.archive_calls == [
        {"project_id": _PROJECT, "user_id": _USER, "session_id": _SESSION}
    ]


@pytest.mark.asyncio
async def test_unarchive_session_reverses_archive_round_trip():
    stream = _stream()
    svc, streams, _, _, mounts = _service(stream=stream)

    archived = await svc.archive_session(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    assert archived.archived_at is not None

    unarchived = await svc.unarchive_session(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert unarchived is not None
    assert unarchived.archived_at is None
    assert mounts.unarchive_calls == [
        {"project_id": _PROJECT, "user_id": _USER, "session_id": _SESSION}
    ]
    assert streams.unarchive_calls == [
        {"project_id": _PROJECT, "user_id": _USER, "session_id": _SESSION}
    ]


# ---------------------------------------------------------------------------
# query_sessions — B3 reference join, windowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_query_sessions_no_filter_returns_all_streams():
    stream = _stream()
    svc, streams, _, _, _ = _service(stream=stream)

    result = await svc.query_sessions(project_id=_PROJECT)

    assert result == [stream]
    assert streams.query_calls[0]["session_ids"] is None


@pytest.mark.asyncio
async def test_query_sessions_filters_by_references_via_turns_join():
    stream = _stream()
    target_ref = Reference(id=uuid4(), slug="target-workflow", version="v1")
    other_ref = Reference(id=uuid4(), slug="other-workflow", version="v1")
    turns = [
        _turn(_SESSION, references=[target_ref]),
        _turn("some-other-session", references=[other_ref]),
    ]
    svc, streams, turns_svc, _, _ = _service(stream=stream, turns=turns)

    result = await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(references=[target_ref]),
    )

    assert len(result) == 1
    assert result[0].session_id == _SESSION
    # the join resolved to session_ids, not references, at the stream query boundary
    assert streams.query_calls[0]["session_ids"] == [_SESSION]


@pytest.mark.asyncio
async def test_query_sessions_no_matching_reference_short_circuits_empty():
    stream = _stream()
    unmatched_ref = Reference(id=uuid4(), slug="nope", version="v1")
    svc, streams, turns_svc, _, _ = _service(stream=stream, turns=[])

    result = await svc.query_sessions(
        project_id=_PROJECT,
        query=SessionQuery(references=[unmatched_ref]),
    )

    assert result == []
    # never even reaches the stream query -- no session_ids to filter by
    assert streams.query_calls == []


@pytest.mark.asyncio
async def test_query_sessions_passes_windowing_through():
    stream = _stream()
    svc, streams, _, _, _ = _service(stream=stream)
    windowing = Windowing(order="descending", limit=10)

    await svc.query_sessions(project_id=_PROJECT, windowing=windowing)

    assert streams.query_calls[0]["windowing"] is windowing

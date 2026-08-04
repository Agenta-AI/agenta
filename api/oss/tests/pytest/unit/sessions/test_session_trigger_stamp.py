"""Unit tests for the automation stamp on a session row.

An automation run is a session nobody named, so its row could say what the run did but never
what fired it: `ag.origin` recorded only THAT something automated started it. The trigger's
identity is stamped by the same writer as the origin — `set_origin` replaces tags wholesale, so
a second writer would need a merge it does not have.

The name is a snapshot, not a live join; see `SessionTriggerRef`.
"""

from typing import Any, Dict, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.sessions.dtos import (
    SESSION_ORIGIN_MANUAL,
    SESSION_ORIGIN_TAG,
    SESSION_ORIGIN_TRIGGER,
    SESSION_TRIGGER_ID_TAG,
    SESSION_TRIGGER_KIND_SCHEDULE,
    SESSION_TRIGGER_KIND_TAG,
    SESSION_TRIGGER_NAME_TAG,
    SessionTriggerRef,
)
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.streams.service import SessionStreamsService


class _RecordingDAO:
    """Captures what `set_origin` writes. `update` returning a row is the common path — the
    stream usually does not exist yet, but either branch writes the same tags."""

    def __init__(self, *, row_exists: bool = True) -> None:
        self.row_exists = row_exists
        self.updated_tags: Optional[Dict[str, Any]] = None
        self.created_tags: Optional[Dict[str, Any]] = None

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updated_tags = stream.tags
        if not self.row_exists:
            return None
        return SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=session_id,
            tags=stream.tags,
        )

    async def create(self, *, project_id, user_id, stream):
        self.created_tags = stream.tags
        return SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            tags=stream.tags,
        )


def _service(dao) -> SessionStreamsService:
    return SessionStreamsService(streams_dao=dao, lock_engine=None)


SESSION_ID = "0" * 32
PROJECT_ID = UUID(int=1)


@pytest.mark.asyncio
async def test_manual_origin_stamps_no_trigger():
    dao = _RecordingDAO()
    await _service(dao).set_origin(
        project_id=PROJECT_ID,
        user_id=None,
        session_id=SESSION_ID,
        origin=SESSION_ORIGIN_MANUAL,
    )
    assert dao.updated_tags == {SESSION_ORIGIN_TAG: SESSION_ORIGIN_MANUAL}


@pytest.mark.asyncio
async def test_trigger_identity_rides_the_origin_write():
    # One write, not two: the tags column is replaced wholesale.
    dao = _RecordingDAO()
    trigger_id = str(uuid4())
    await _service(dao).set_origin(
        project_id=PROJECT_ID,
        user_id=None,
        session_id=SESSION_ID,
        origin=SESSION_ORIGIN_TRIGGER,
        trigger=SessionTriggerRef(
            id=trigger_id,
            name="Nightly digest",
            kind=SESSION_TRIGGER_KIND_SCHEDULE,
        ),
    )
    assert dao.updated_tags == {
        SESSION_ORIGIN_TAG: SESSION_ORIGIN_TRIGGER,
        SESSION_TRIGGER_ID_TAG: trigger_id,
        SESSION_TRIGGER_NAME_TAG: "Nightly digest",
        SESSION_TRIGGER_KIND_TAG: SESSION_TRIGGER_KIND_SCHEDULE,
    }
    assert dao.created_tags is None


@pytest.mark.asyncio
async def test_unnamed_trigger_omits_the_name_rather_than_stamping_empty():
    # A blank name would render as a blank row title; absence lets the row fall back.
    dao = _RecordingDAO()
    trigger_id = str(uuid4())
    await _service(dao).set_origin(
        project_id=PROJECT_ID,
        user_id=None,
        session_id=SESSION_ID,
        origin=SESSION_ORIGIN_TRIGGER,
        trigger=SessionTriggerRef(id=trigger_id, name=None, kind=None),
    )
    assert dao.updated_tags == {
        SESSION_ORIGIN_TAG: SESSION_ORIGIN_TRIGGER,
        SESSION_TRIGGER_ID_TAG: trigger_id,
    }


@pytest.mark.asyncio
async def test_create_branch_stamps_the_same_tags():
    # The row usually does NOT exist yet — the stamp happens before the run creates it.
    dao = _RecordingDAO(row_exists=False)
    trigger_id = str(uuid4())
    await _service(dao).set_origin(
        project_id=PROJECT_ID,
        user_id=None,
        session_id=SESSION_ID,
        origin=SESSION_ORIGIN_TRIGGER,
        trigger=SessionTriggerRef(
            id=trigger_id, name="On PR opened", kind="subscription"
        ),
    )
    assert dao.created_tags == dao.updated_tags
    assert dao.created_tags[SESSION_TRIGGER_NAME_TAG] == "On PR opened"

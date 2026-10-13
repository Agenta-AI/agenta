"""The records-incomplete flag against a real Postgres.

`test_records_incomplete.py` pins the SQL without a database. These cases run it: the first
report sets the time, a later report keeps it, nothing clears it, and a session with no
cursor yet gets one that the next sequenced append continues from 1.

Requires the tracing_oss chain through oss000000007, with POSTGRES_URI_TRACING pointed at
that database.
"""

import uuid

import pytest
from sqlalchemy import select

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.dbs.postgres.sessions.records.dbes import SessionSequenceCursorDBE
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_analytics_engine
from oss.src.utils.env import env


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _every_case_here_reads_the_tracing_database(the_tracing_database):
    """The records DAO is built on `get_analytics_engine()`, whose address is
    POSTGRES_URI_TRACING."""


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None


def _ids():
    return uuid.uuid4(), f"incomplete-test-{uuid.uuid4().hex[:8]}"


async def _marked_at(project_id, session_id):
    async with get_analytics_engine().session() as session:
        return await session.scalar(
            select(SessionSequenceCursorDBE.records_incomplete_at).where(
                SessionSequenceCursorDBE.project_id == project_id,
                SessionSequenceCursorDBE.session_id == session_id,
            )
        )


async def test_the_first_report_sets_the_time_and_a_later_one_keeps_it():
    project_id, session_id = _ids()
    dao = RecordsDAO(engine=get_analytics_engine())
    assert not await dao.get_records_incomplete(
        project_id=project_id, session_id=session_id
    )

    await dao.mark_records_incomplete(project_id=project_id, session_id=session_id)
    first = await _marked_at(project_id, session_id)
    await dao.mark_records_incomplete(project_id=project_id, session_id=session_id)

    assert first is not None
    assert await _marked_at(project_id, session_id) == first
    assert await dao.get_records_incomplete(
        project_id=project_id, session_id=session_id
    )


async def test_the_flag_survives_later_appends():
    if not env.sessions.sequence_writes:
        pytest.skip("sequenced record writes are off")
    project_id, session_id = _ids()
    dao = RecordsDAO(engine=get_analytics_engine())

    await dao.mark_records_incomplete(project_id=project_id, session_id=session_id)
    record = await dao.append(
        event=SessionRecordEvent(
            project_id=project_id,
            session_id=session_id,
            record_id=uuid.uuid4(),
            record_index=0,
            record_type="message",
            record_source="agent",
            attributes={"type": "message", "text": "after the drop"},
        )
    )

    # The cursor the report created starts at 0, so sequencing is unchanged.
    assert record is not None and record.sequence == 1
    assert await dao.get_records_incomplete(
        project_id=project_id, session_id=session_id
    )

"""The trigger claim writes the initial policy on a new session row only (M3 Task 8).

The claim is an `INSERT ... ON CONFLICT DO UPDATE`: the insert carries `visibility` and
`owner_user_id`, and the conflict arm merges the attribution tags only, so an existing
row keeps its policy.
"""

import uuid

import pytest
from sqlalchemy import text

import oss.src.models.db_models  # noqa: F401
from oss.src.core.sessions.dtos import SessionTriggerAttribution, SessionTriggerKind
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    Visibility,
)
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.integration.sessions import (
    test_trigger_session_claim_postgres as _claim_tests,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

# The project, user and active schedule the claim tests seed.
trigger_project = _claim_tests.trigger_project


def _attribution(schedule_id) -> SessionTriggerAttribution:
    return SessionTriggerAttribution(
        configuration_id=schedule_id,
        kind=SessionTriggerKind.schedule,
        delivery_id=uuid.uuid4(),
    )


async def _row(project_id, session_id):
    async with get_transactions_engine().session() as session:
        result = await session.execute(
            text(
                "SELECT visibility, owner_user_id, tags FROM session_streams "
                "WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {"project_id": project_id, "session_id": session_id},
        )
        return result.one()


async def test_claim_insert_writes_policy(trigger_project):
    project_id = trigger_project["project_id"]
    alice = trigger_project["user_id"]
    session_id = uuid.uuid4().hex
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    claimed = await dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=alice,
        event_id="event-private",
        session_id=session_id,
        attribution=_attribution(trigger_project["schedule_id"]),
        access=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice),
    )

    assert claimed is True
    visibility, owner_user_id, _ = await _row(project_id, session_id)
    assert visibility == "private"
    assert owner_user_id == alice

    stream = await dao.get_by_session_id(project_id=project_id, session_id=session_id)
    assert stream.visibility == Visibility.PRIVATE
    assert stream.owner_user_id == alice


async def test_claim_insert_writes_the_ownerless_policy(trigger_project):
    project_id = trigger_project["project_id"]
    session_id = uuid.uuid4().hex
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    await dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=trigger_project["user_id"],
        event_id="event-ownerless",
        session_id=session_id,
        attribution=_attribution(trigger_project["schedule_id"]),
        access=OWNERLESS_PROJECT_POLICY,
    )

    visibility, owner_user_id, _ = await _row(project_id, session_id)
    assert visibility == "project"
    assert owner_user_id is None


async def test_claim_conflict_arm_tags_only(trigger_project):
    project_id = trigger_project["project_id"]
    alice = trigger_project["user_id"]
    schedule_id = trigger_project["schedule_id"]
    session_id = uuid.uuid4().hex
    dao = SessionStreamsDAO(engine=get_transactions_engine())

    first = _attribution(schedule_id)
    await dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=alice,
        event_id="event-first",
        session_id=session_id,
        attribution=first,
        access=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice),
    )

    second = _attribution(schedule_id)
    claimed = await dao.claim_trigger_delivery(
        project_id=project_id,
        user_id=alice,
        event_id="event-second",
        session_id=session_id,
        attribution=second,
        access=OWNERLESS_PROJECT_POLICY,
    )

    assert claimed is True
    visibility, owner_user_id, tags = await _row(project_id, session_id)
    assert visibility == "private"
    assert owner_user_id == alice
    # The conflict arm merged the second claim's attribution tags.
    assert tags["ag.trigger.delivery_id"] == str(second.delivery_id)

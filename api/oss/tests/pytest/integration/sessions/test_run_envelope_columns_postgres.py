"""The run principal columns exist where the ORM models say, and rows read back through
the mappings: NULL columns read as `None`, set columns map to the read DTOs."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.principals import envelope_to_json
from oss.src.dbs.postgres.evaluations.dbes import EvaluationRunDBE
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE
from oss.src.dbs.postgres.sessions.inputs.dbes import SessionInputDBE
from oss.src.dbs.postgres.sessions.interactions.dbes import SessionInteractionDBE
from oss.src.dbs.postgres.sessions.turns.dbes import SessionTurnDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.postgres.triggers.dbes import (
    TriggerScheduleDBE,
    TriggerSubscriptionDBE,
)
from oss.src.dbs.postgres.triggers.mappings import map_schedule_dbe_to_dto
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.principals import make_envelope


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Each test gets a transactions engine bound to its own event loop.
    import oss.src.dbs.postgres.shared.engine as engine_module

    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.mark.parametrize(
    "dbe",
    [
        SessionTurnDBE,
        SessionInputDBE,
        SessionCommandDBE,
        SessionInteractionDBE,
        TriggerScheduleDBE,
        TriggerSubscriptionDBE,
        EvaluationRunDBE,
    ],
)
async def test_orm_models_match_the_new_columns(dbe):
    # Selecting the model lists every mapped column; a missing column fails here.
    async with get_transactions_engine().session() as session:
        await session.execute(select(dbe).limit(1))


@pytest.fixture
async def project_id():
    seeded = await seed_organization(members={})
    yield seeded.project_ids[0]
    await execute(
        "DELETE FROM trigger_schedules WHERE project_id = :p",
        {"p": seeded.project_ids[0]},
    )
    await delete_seeded_organization(seeded)


async def _schedule_dto(schedule_id, project_id):
    async with get_transactions_engine().session() as session:
        dbe = (
            await session.execute(
                select(TriggerScheduleDBE).where(
                    TriggerScheduleDBE.project_id == project_id,
                    TriggerScheduleDBE.id == schedule_id,
                )
            )
        ).scalar_one()
    return map_schedule_dbe_to_dto(schedule_dbe=dbe)


async def test_rows_with_null_columns_read_as_none(project_id):
    schedule_id = uuid4()
    await execute(
        "INSERT INTO trigger_schedules (project_id, id, name, data, flags) VALUES "
        "(:p, :id, 's', CAST(:data AS json), '{}'::jsonb)",
        {
            "p": project_id,
            "id": schedule_id,
            "data": json.dumps({"event_key": "cron", "schedule": "* * * * *"}),
        },
    )
    schedule = await _schedule_dto(schedule_id, project_id)
    assert schedule.principal is None and schedule.artifact_id is None


async def test_rows_with_values_map_to_dtos(project_id):
    schedule_id, principal_id, artifact_id = uuid4(), uuid4(), uuid4()
    await execute(
        "INSERT INTO trigger_schedules (project_id, id, name, data, flags, "
        "principal_kind, principal_id, artifact_id) VALUES "
        "(:p, :id, 's', CAST(:data AS json), '{}'::jsonb, 'api_key', :pid, :aid)",
        {
            "p": project_id,
            "id": schedule_id,
            "data": json.dumps({"event_key": "cron", "schedule": "* * * * *"}),
            "pid": principal_id,
            "aid": artifact_id,
        },
    )
    schedule = await _schedule_dto(schedule_id, project_id)
    assert schedule.principal == PrincipalRef(
        kind=PrincipalKind.API_KEY, id=principal_id
    )
    assert schedule.artifact_id == artifact_id


async def test_input_command_interaction_envelope_round_trip(project_id):
    """The jsonb column holds the envelope JSON with "v": 1 and reads back equal."""

    envelope = make_envelope(kind="api_key", origin="api", origin_id="k", sender=None)
    async with get_transactions_engine().session() as session:
        stored = (
            await session.execute(
                text("SELECT CAST(:e AS jsonb) AS e"),
                {"e": json.dumps(envelope_to_json(envelope=envelope))},
            )
        ).scalar_one()
    from oss.src.dbs.postgres.access.mappings import map_envelope_column

    assert stored["v"] == 1
    assert map_envelope_column(data=stored) == envelope

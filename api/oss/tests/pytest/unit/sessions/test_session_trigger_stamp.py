from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.dtos import (
    SessionOrigin,
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO


class _Result:
    def scalar_one_or_none(self):
        return uuid4()


class _Session:
    def __init__(self):
        self.statement = None
        self.commits = 0
        self.rollbacks = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def execute(self, statement):
        self.statement = statement
        statement.compile(dialect=postgresql.dialect())
        return _Result()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class _Engine:
    def __init__(self):
        self.db_session = _Session()

    def session(self):
        return self.db_session


def test_trigger_attribution_contains_only_durable_identifiers():
    configuration_id = uuid4()
    delivery_id = uuid4()

    attribution = SessionTriggerAttribution(
        configuration_id=configuration_id,
        kind=SessionTriggerKind.schedule,
        delivery_id=delivery_id,
    )

    assert attribution.model_dump() == {
        "configuration_id": configuration_id,
        "kind": SessionTriggerKind.schedule,
        "delivery_id": delivery_id,
    }
    assert "name" not in SessionTriggerAttribution.model_fields
    assert "meta" not in SessionTriggerAttribution.model_fields


@pytest.mark.parametrize("kind", ["schedule", "subscription"])
def test_trigger_kind_is_typed(kind):
    attribution = SessionTriggerAttribution(
        configuration_id=uuid4(),
        kind=kind,
        delivery_id=uuid4(),
    )
    assert attribution.kind == SessionTriggerKind(kind)


def test_unknown_trigger_kind_is_rejected():
    with pytest.raises(ValidationError):
        SessionTriggerAttribution(
            configuration_id=uuid4(),
            kind="webhook",
            delivery_id=uuid4(),
        )


def test_session_origin_is_typed():
    assert {origin.value for origin in SessionOrigin} == {"manual", "trigger"}


async def test_claim_compiles_as_one_postgres_statement():
    engine = _Engine()
    dao = SessionStreamsDAO(engine=engine)
    session_id = uuid4().hex
    configuration_id = uuid4()
    delivery_id = uuid4()

    claimed = await dao.claim_trigger_delivery(
        project_id=uuid4(),
        user_id=uuid4(),
        event_id="event-1",
        session_id=session_id,
        attribution=SessionTriggerAttribution(
            configuration_id=configuration_id,
            kind=SessionTriggerKind.subscription,
            delivery_id=delivery_id,
        ),
    )

    compiled = engine.db_session.statement.compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}
    )
    sql = str(compiled)
    assert claimed is True
    assert sql.startswith("WITH live_trigger_configuration AS")
    assert "trigger_subscriptions.deleted_at IS NULL" in sql
    assert "trigger_subscriptions.flags @>" in sql
    assert "FOR UPDATE" in sql
    assert "claimed_trigger_delivery AS" in sql
    assert "INSERT INTO trigger_deliveries" in sql
    # P1-8: the delivery claim re-claims a retryable-failed row instead of
    # leaving it permanently stuck — DO UPDATE, gated on the existing row's
    # status, not a bare DO NOTHING.
    assert "ON CONFLICT (project_id, subscription_id, event_id)" in sql
    delivery_insert = sql.split("INSERT INTO trigger_deliveries", 1)[1].split(
        "INSERT INTO session_streams", 1
    )[0]
    assert "DO UPDATE SET" in delivery_insert
    assert "WHERE (trigger_deliveries.status" in delivery_insert
    assert "INSERT INTO session_streams" in sql
    assert "ON CONFLICT (project_id, session_id) DO UPDATE" in sql
    assert "coalesce(session_streams.tags" in sql
    assert " || excluded.tags" in sql
    # The session_streams INSERT's SELECT must read FROM the delivery CTE, not run
    # unconditionally — that's what makes a lost delivery claim (empty CTE) insert
    # zero rows instead of stamping a session anyway. The fake session below always
    # returns a UUID regardless of statement shape (`assert claimed is True` alone
    # is tautological), so this checks the actual SQL dependency: removing
    # `.select_from(claimed_delivery)` from the DAO would drop this substring.
    session_streams_insert = sql.split("INSERT INTO session_streams", 1)[1].split(
        "ON CONFLICT", 1
    )[0]
    assert "FROM claimed_trigger_delivery" in session_streams_insert
    object_parameters = [
        value for value in compiled.params.values() if isinstance(value, dict)
    ]
    assert {"session_id": session_id} in object_parameters
    claim_status = next(
        value for value in object_parameters if value.get("message") == "claimed"
    )
    assert claim_status["code"] == "102"
    assert claim_status["timestamp"]
    assert {
        "ag.origin": "trigger",
        "ag.trigger.id": str(configuration_id),
        "ag.trigger.kind": "subscription",
        "ag.trigger.delivery_id": str(delivery_id),
    } in object_parameters
    assert engine.db_session.commits == 1
    assert engine.db_session.rollbacks == 0

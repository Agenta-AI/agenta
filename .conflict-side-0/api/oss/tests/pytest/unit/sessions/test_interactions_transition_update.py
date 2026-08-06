from uuid import uuid4

from sqlalchemy.dialects import postgresql

from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO


class _Result:
    def scalar_one_or_none(self):
        return None


class _Session:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result()

    async def commit(self):
        return None


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _Engine:
    def __init__(self, session):
        self._session = session

    def session(self):
        return _SessionContext(self._session)


async def _transition_statement(resolution=None):
    session = _Session()
    dao = SessionInteractionsDAO(engine=_Engine(session))
    await dao.transition_interaction(
        transition=SessionInteractionTransition(
            project_id=uuid4(),
            session_id="session-1",
            token="token-1",
            status=SessionInteractionStatus.resolved,
            resolution=resolution,
        )
    )
    return session.statement


async def test_resolution_update_preserves_existing_data_with_jsonb_set():
    resolution = {"verdict": "approved", "tool_call_id": "tool-1"}
    statement = await _transition_statement(resolution)
    compiled = statement.compile(dialect=postgresql.dialect())
    set_clause = str(compiled).split(" WHERE ", maxsplit=1)[0]

    assert "jsonb_set" in set_clause
    assert "CAST(session_interactions.data AS JSONB)" in set_clause
    assert resolution in compiled.params.values()


async def test_transition_without_resolution_does_not_write_data():
    statement = await _transition_statement()
    set_clause = str(statement.compile(dialect=postgresql.dialect())).split(
        " WHERE ", maxsplit=1
    )[0]

    assert "data=" not in set_clause

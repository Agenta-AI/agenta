"""SQL-shape coverage for hosted Telegram disconnect cleanup.

The lifecycle fix lives in the Postgres DAO. This test intentionally captures
its statements instead of claiming a database integration test is available.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from oss.src.dbs.postgres.channels.telegram_bind_dao import TelegramBindingDAO
from sqlalchemy.dialects import postgresql

pytestmark = pytest.mark.asyncio


class _Result:
    rowcount = 2


class _Session:
    def __init__(self):
        self.statements = []
        self.committed = False

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result()

    async def commit(self):
        self.committed = True


class _Engine:
    def __init__(self):
        self.captured = _Session()

    @asynccontextmanager
    async def session(self):
        yield self.captured


async def test_disconnect_removes_pending_tokens_and_account_links_with_bindings():
    engine = _Engine()
    dao = TelegramBindingDAO(engine=engine)

    removed = await dao.delete_bindings_for_connection(connection_id=uuid4())

    assert removed == 2
    assert engine.captured.committed is True
    statements = [
        str(statement.compile(dialect=postgresql.dialect()))
        for statement in engine.captured.statements
    ]
    assert len(statements) == 3
    assert "DELETE FROM channel_telegram_bind_tokens" in statements[0]
    assert "channel_telegram_bind_tokens.consumed_at IS NULL" in statements[0]
    assert "DELETE FROM channel_identity_links" in statements[1]
    assert "DELETE FROM channel_telegram_chat_bindings" in statements[2]

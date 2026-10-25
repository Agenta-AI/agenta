"""Serializable secrets writes retry a serialization failure a fixed number of times, then
answer `SecretWriteConflict` (M5). Each retry logs at debug with ids only."""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError

import oss.src.dbs.postgres.secrets.dao as dao_module
from oss.src.core.secrets.types import SecretWriteConflict
from oss.src.dbs.postgres.secrets.dao import SecretsDAO


class _SerializationFailure(Exception):
    sqlstate = "40001"


class _FakeEngine:
    def __init__(self):
        self.isolation_levels = []

    @asynccontextmanager
    async def transaction(self, *, isolation_level=None):
        self.isolation_levels.append(isolation_level)
        yield object()


class _RecordingLog:
    def __init__(self):
        self.debug_calls = []

    def debug(self, message, **fields):
        self.debug_calls.append((message, fields))


@pytest.fixture
def no_wait(monkeypatch):
    async def _no_wait(attempt):
        return None

    monkeypatch.setattr(dao_module, "_wait_before_retry", _no_wait)


@pytest.fixture
def recording_log(monkeypatch):
    log = _RecordingLog()
    monkeypatch.setattr(dao_module, "log", log)
    return log


def test_the_attempt_count_is_six():
    assert dao_module._SERIALIZABLE_ATTEMPTS == 6


async def test_a_write_that_always_fails_serialization_runs_six_times_then_conflicts(
    no_wait, recording_log
):
    engine = _FakeEngine()
    dao = SecretsDAO(engine=engine)
    organization_id, secret_id = uuid4(), uuid4()
    calls = []

    async def work(connection):
        calls.append(connection)
        raise DBAPIError("UPDATE secrets", {}, _SerializationFailure())

    with pytest.raises(SecretWriteConflict):
        await dao._serializable(
            work,
            operation="update_organization_secret",
            ids={"organization_id": organization_id, "secret_id": secret_id},
        )

    assert len(calls) == 6
    assert engine.isolation_levels == ["SERIALIZABLE"] * 6
    # One debug line per retry (five), each with the operation, the attempt and ids only.
    assert [fields["attempt"] for _, fields in recording_log.debug_calls] == [
        1,
        2,
        3,
        4,
        5,
    ]
    for message, fields in recording_log.debug_calls:
        assert message == "[secrets] serializable write retried"
        assert fields == {
            "operation": "update_organization_secret",
            "attempt": fields["attempt"],
            "organization_id": str(organization_id),
            "secret_id": str(secret_id),
        }


async def test_a_write_that_succeeds_on_a_retry_returns_its_result(
    no_wait, recording_log
):
    dao = SecretsDAO(engine=_FakeEngine())
    calls = []

    async def work(connection):
        calls.append(connection)
        if len(calls) < 3:
            raise DBAPIError("INSERT INTO secrets", {}, _SerializationFailure())
        return "stored"

    result = await dao._serializable(
        work, operation="create_organization_secret", ids={"organization_id": uuid4()}
    )

    assert result == "stored"
    assert len(calls) == 3
    assert len(recording_log.debug_calls) == 2

"""The runner decides from the core database's `alembic_version` whether it runs the
legacy core chain, and refuses a database below `park00000000` before any change.
The replay against real databases is `ee/tests/replay/migrations_replay.py`."""

import pytest

from ee.databases.postgres.migrations import runner


def _revisions(value):
    async def read():
        return value

    return read


def test_empty_database_runs_the_legacy_chain(monkeypatch):
    monkeypatch.setattr(runner, "read_legacy_core_revisions", _revisions(None))
    assert runner._legacy_core_chain_needed() is True


def test_parked_database_skips_the_legacy_chain(monkeypatch):
    monkeypatch.setattr(
        runner, "read_legacy_core_revisions", _revisions(["park00000000"])
    )
    assert runner._legacy_core_chain_needed() is False


@pytest.mark.parametrize("revisions", [["4f5a6b7c8d9e"], ["0a1b2c3d4e5f"], []])
def test_older_database_stops_before_any_step(monkeypatch, capsys, revisions):
    monkeypatch.setattr(runner, "read_legacy_core_revisions", _revisions(revisions))
    monkeypatch.setattr(
        runner,
        "split_core_and_tracing",
        lambda: pytest.fail("the split step must not run"),
    )

    with pytest.raises(SystemExit) as exit_:
        runner.main()

    assert exit_.value.code == 1
    error = capsys.readouterr().err
    assert "older than v0.104.0" in error
    assert "Upgrade to v0.129.x first" in error
    for revision in revisions:
        assert revision in error


@pytest.mark.asyncio
async def test_before_the_split_the_legacy_core_name_is_read(monkeypatch):
    """An older database not yet split still has its legacy name, such as `agenta_oss`.
    The check reads that name, so the refusal also covers it."""
    from sqlalchemy.engine import make_url

    from ee.databases.postgres.migrations import utils

    core = make_url(utils.env.postgres.uri_core).database
    legacy = next(old for old, new in utils.RENAME_MAP.items() if new == core)
    read_uris = []

    async def fetch_scalar(uri, query, params=None):
        if params is not None:
            return 1 if params["name"] == legacy else None
        return "alembic_version"

    class _Conn:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def execute(self, _query):
            return [("4f5a6b7c8d9e",)]

    class _Engine:
        def connect(self):
            return _Conn()

        async def dispose(self):
            return None

    def engine(uri):
        read_uris.append(uri)
        return _Engine()

    monkeypatch.setattr(utils, "_fetch_scalar", fetch_scalar)
    monkeypatch.setattr(utils, "create_async_engine", engine)

    assert await utils.read_legacy_core_revisions() == ["4f5a6b7c8d9e"]
    assert read_uris == [utils._database_uri(legacy)]

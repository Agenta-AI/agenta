"""The runner adopts an open source database (membership step, then core_ee) only
when automatic migrations are on, because the membership step needs the core_oss
head. The replay against real databases is `ee/tests/replay/migrations_replay.py`."""

import pytest

from ee.databases.postgres.migrations import runner


def _async(value=None):
    async def call(*args, **kwargs):
        return value

    return call


@pytest.fixture
def steps(monkeypatch):
    calls = []
    monkeypatch.setattr(runner, "_legacy_core_chain_needed", lambda: False)
    monkeypatch.setattr(runner, "split_core_and_tracing", _async())
    monkeypatch.setattr(runner, "copy_nodes_from_core_to_tracing", _async())
    for name in (
        "migrate_core_oss",
        "migrate_core_ee",
        "migrate_tracing",
        "migrate_tracing_oss",
        "migrate_tracing_ee",
    ):
        monkeypatch.setattr(runner, name, lambda name=name: calls.append(name))

    async def materialize():
        calls.append("memberships")

    monkeypatch.setattr(runner, "_materialize_memberships", materialize)
    return calls


def _run(monkeypatch, *, open_source: bool, auto_migrations: bool) -> None:
    monkeypatch.setattr(runner, "is_open_source_database", _async(open_source))
    monkeypatch.setattr(runner.env.alembic, "auto_migrations", auto_migrations)
    runner.main()


def test_open_source_database_is_adopted(monkeypatch, steps):
    _run(monkeypatch, open_source=True, auto_migrations=True)
    assert steps.index("memberships") < steps.index("migrate_core_ee")


def test_open_source_database_stays_open_source_with_migrations_off(
    monkeypatch, steps, capsys
):
    _run(monkeypatch, open_source=True, auto_migrations=False)
    assert "memberships" not in steps
    assert "migrate_core_ee" not in steps
    assert "migrate_tracing_ee" in steps
    assert "skipping the membership step" in capsys.readouterr().out


@pytest.mark.parametrize("auto_migrations", [True, False])
def test_ee_database_runs_core_ee_without_the_membership_step(
    monkeypatch, steps, auto_migrations
):
    _run(monkeypatch, open_source=False, auto_migrations=auto_migrations)
    assert "memberships" not in steps
    assert "migrate_core_ee" in steps

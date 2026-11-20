import os
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.instances import service as instances_service
from oss.src.dbs.postgres.instances import dao as instances_dao_module
from oss.src.utils import env as env_module
from oss.src.core.instances.types import InstanceMissing
from oss.src.utils.env import env


@pytest.mark.parametrize(
    ("web_url", "ci", "kind"),
    [
        ("http://localhost", False, "development"),
        ("http://127.0.0.1:8080", False, "development"),
        ("http://192.168.1.20", False, "development"),
        ("http://10.0.0.5/agenta", False, "development"),
        ("https://agenta.example.com", False, "production"),
        ("https://agenta.example.com", True, "ci"),
    ],
)
def test_instance_kind(monkeypatch, web_url, ci, kind):
    monkeypatch.setattr(env.agenta, "web_url", web_url)
    monkeypatch.setattr(env.telemetry, "ci", ci)

    assert instances_service.get_instance_kind() == kind


@pytest.mark.parametrize(("license", "edition"), [("ee", "ee"), ("oss", "oss")])
def test_edition(monkeypatch, license, edition):
    monkeypatch.setattr(env.agenta, "license", license)

    assert instances_service.get_edition() == edition


@pytest.mark.asyncio
async def test_instance_id_is_read_once(monkeypatch):
    instance_id = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")
    fetch = AsyncMock(return_value=instance_id)
    monkeypatch.setattr(instances_service, "_instance_id", None)
    monkeypatch.setattr(instances_service.instances_dao, "fetch_instance_id", fetch)

    assert await instances_service.get_instance_id() == instance_id
    assert await instances_service.get_instance_id() == instance_id
    fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_missing_row_raises(monkeypatch):
    monkeypatch.setattr(instances_service, "_instance_id", None)
    monkeypatch.setattr(
        instances_service.instances_dao,
        "fetch_instance_id",
        AsyncMock(return_value=None),
    )

    with pytest.raises(InstanceMissing):
        await instances_service.get_instance_id()


@pytest.mark.asyncio
async def test_install_ping_skips_a_preexisting_install(monkeypatch):
    """An install that had data before the instances migration sends no install ping."""
    statements = []
    result = MagicMock()
    result.scalar_one_or_none.return_value = None

    async def _execute(statement):
        statements.append(statement)
        return result

    connection = MagicMock()
    connection.execute = _execute

    @asynccontextmanager
    async def _transaction():
        yield connection

    engine = MagicMock()
    engine.transaction = _transaction
    monkeypatch.setattr(instances_dao_module, "get_transactions_engine", lambda: engine)

    async with instances_dao_module.InstancesDAO().lock_unsent_install_ping() as found:
        assert found is None

    sql = str(
        statements[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "instances.preexisting IS false" in sql
    assert "instances.installed_event_sent_at IS NULL" in sql


def test_migration_marks_an_upgraded_install_as_preexisting():
    migration = (
        Path(__file__).resolve().parents[4]
        / "databases/postgres/migrations/core_oss/versions"
        / "oss000000064_add_instances.py"
    ).read_text()

    assert "EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM organizations)" in (
        migration
    )


@pytest.mark.parametrize(
    ("variable", "kubernetes_host", "dockerenv", "method"),
    [
        ("helm", "10.0.0.1", True, "helm"),
        ("compose", None, True, "compose"),
        ("railway", None, False, "railway"),
        ("", "10.0.0.1", True, "kubernetes"),
        ("", None, True, "docker"),
        ("", None, False, None),
        ("podman", None, True, None),
    ],
)
def test_deployment_method(monkeypatch, variable, kubernetes_host, dockerenv, method):
    monkeypatch.setenv("AGENTA_DEPLOYMENT_METHOD", variable)
    if kubernetes_host:
        monkeypatch.setenv("KUBERNETES_SERVICE_HOST", kubernetes_host)
    else:
        monkeypatch.delenv("KUBERNETES_SERVICE_HOST", raising=False)
    real_exists = os.path.exists
    monkeypatch.setattr(
        env_module.os.path,
        "exists",
        lambda path: dockerenv if path == "/.dockerenv" else real_exists(path),
    )

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        assert env_module._parse_deployment_method() == method

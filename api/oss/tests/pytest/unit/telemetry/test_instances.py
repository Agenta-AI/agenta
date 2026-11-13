from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from oss.src.core.instances import service as instances_service
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

"""The telemetry docs page must list exactly what each instance event sends."""

import ast
import inspect
from uuid import UUID

import pytest

from oss.src.core.telemetry import service as telemetry_service
from oss.src.core.telemetry.heartbeat import InstanceHeartbeat
from oss.src.core.telemetry.runtime import InstanceStarted
from oss.src.middlewares import analytics
from oss.tests.pytest.unit.telemetry._docs import documented_fields


@pytest.mark.asyncio
async def test_install_ping_table_matches_the_payload_on_the_wire(monkeypatch):
    """Reads the properties the PostHog client really posts, library additions included."""
    batches = []
    monkeypatch.setattr(
        "posthog.client.batch_post",
        lambda api_key, host=None, **kwargs: batches.append(kwargs["batch"]),
    )
    telemetry_service._sync_client.cache_clear()
    instance_id = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")

    await telemetry_service.capture(
        telemetry_service.INSTANCE_INSTALLED_EVENT,
        str(instance_id),
        {
            **telemetry_service.INSTANCE_INSTALLED_PROPERTIES,
            "instance_kind": "production",
        },
    )
    telemetry_service._sync_client.cache_clear()

    [[message]] = batches
    sent = set(message["properties"])
    documented = documented_fields("Install ping")
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"


@pytest.mark.asyncio
async def test_heartbeat_table_matches_the_payload_on_the_wire(monkeypatch):
    """Reads the properties the PostHog client really posts, library additions included."""
    batches = []
    monkeypatch.setattr(
        "posthog.client.batch_post",
        lambda api_key, host=None, **kwargs: batches.append(kwargs["batch"]),
    )
    telemetry_service._sync_client.cache_clear()
    # Values do not matter here, only the keys: every field of the model is sent.
    heartbeat = InstanceHeartbeat.model_construct(
        **{name: None for name in InstanceHeartbeat.model_fields},
    )
    heartbeat.instance_id = "3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07"
    heartbeat.user_domains = []

    await telemetry_service.capture(
        "instance_heartbeat",
        heartbeat.instance_id,
        {
            **heartbeat.model_dump(mode="json"),
            "$groups": {"instance": heartbeat.instance_id},
        },
    )
    telemetry_service._sync_client.cache_clear()

    [[message]] = batches
    sent = set(message["properties"])
    documented = documented_fields("Heartbeat")
    # The library adds `$os_distro` on Linux only.
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent - {"$os_distro"}, (
        f"not in the payload: {sorted(documented - sent)}"
    )


@pytest.mark.asyncio
async def test_startup_event_table_matches_the_payload_on_the_wire(monkeypatch):
    """Reads the properties the PostHog client really posts, library additions included."""
    batches = []
    monkeypatch.setattr(
        "posthog.client.batch_post",
        lambda api_key, host=None, **kwargs: batches.append(kwargs["batch"]),
    )
    telemetry_service._sync_client.cache_clear()
    instance_id = "3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07"
    started = InstanceStarted(
        instance_id=instance_id,
        instance_kind="production",
        agenta_version="v0.129.0",
        edition="oss",
        deployment_method="compose",
        instance_host="agenta.example.com",
        cpu_count=8,
        memory_mb=32000,
        memory_limit_mb=None,
        postgres_version="16.4",
    )

    await telemetry_service.capture(
        telemetry_service.INSTANCE_STARTED_EVENT,
        instance_id,
        {
            **started.model_dump(mode="json"),
            "$groups": {"instance": instance_id},
            "$process_person_profile": False,
        },
    )
    telemetry_service._sync_client.cache_clear()

    [[message]] = batches
    sent = set(message["properties"])
    documented = documented_fields("Startup event")
    # The library adds `$os_distro` on Linux only.
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent - {"$os_distro"}, (
        f"not in the payload: {sorted(documented - sent)}"
    )
    assert {"$os", "$python_version", "$lib_version"} <= sent


def test_every_api_event_name_and_mark_is_documented():
    """Reads every event name the middleware can return, so a new route fails here."""
    tree = ast.parse(inspect.getsource(analytics._get_event_name_from_path))
    events = {
        node.value.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Return)
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    }
    marks = {mark for mark, _ in analytics.ACTIVATION_EVENTS.values()}
    sent = events | set(analytics.ACTIVATION_EVENTS) | marks

    documented = documented_fields("Product events from the API")
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"

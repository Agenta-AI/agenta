"""The telemetry docs page must list exactly what each instance event sends."""

import ast
import inspect
from uuid import UUID

import pytest

from oss.src.core.telemetry import service as telemetry_service
from oss.src.core.telemetry.heartbeat import InstanceHeartbeat
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
        dict(telemetry_service.INSTANCE_INSTALLED_PROPERTIES),
    )
    telemetry_service._sync_client.cache_clear()

    [[message]] = batches
    sent = set(message["properties"])
    documented = documented_fields("Install ping")
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"


def test_heartbeat_table_matches_the_model():
    documented = documented_fields("Heartbeat")
    # The PostHog client adds `$geoip_disable` to every event it sends.
    sent = set(InstanceHeartbeat.model_fields) | {"$groups", "$geoip_disable"}

    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"


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

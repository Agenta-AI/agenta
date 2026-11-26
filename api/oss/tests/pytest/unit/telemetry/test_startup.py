"""The `instance_started` event and the machine facts it carries."""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from oss.src.core.telemetry import runtime
from oss.src.core.telemetry import service as telemetry_service
from oss.src.utils.env import env
from oss.tests.pytest.unit.telemetry._edition import set_edition

INSTANCE_ID = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")
# The fixture below replaces it; the cgroup tests call the real one.
_memory_limit_mb = runtime._memory_limit_mb


class _PostHog:
    def __init__(self, fail: Exception | None = None):
        self.captures = []
        self.fail = fail

    def capture(self, event=None, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.captures.append({"event": event, **kwargs})
        return "recorded"


@pytest.fixture
def posthog(monkeypatch):
    fake = _PostHog()
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: fake)
    return fake


@pytest.fixture(autouse=True)
def self_hosted(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", None)
    monkeypatch.setattr(env.telemetry, "enabled", True)
    monkeypatch.setattr(env.telemetry, "enabled_set", False)
    monkeypatch.setattr(env.telemetry, "deployment_method", "compose")
    monkeypatch.setattr(env.telemetry, "ci", False)
    set_edition(monkeypatch, "oss")
    monkeypatch.setattr(env.agenta, "web_url", "https://Agenta.Example.com:8443/app")
    monkeypatch.setattr(
        telemetry_service, "get_instance_id", AsyncMock(return_value=INSTANCE_ID)
    )
    monkeypatch.setattr(runtime, "get_agenta_version", lambda: "v0.129.0")
    monkeypatch.setattr(runtime.os, "cpu_count", lambda: 8)
    monkeypatch.setattr(runtime, "_memory_mb", lambda: 32000)
    monkeypatch.setattr(runtime, "_memory_limit_mb", lambda: 4096)
    monkeypatch.setattr(
        runtime.instances_dao,
        "fetch_postgres_version",
        AsyncMock(return_value="16.4"),
    )


@pytest.mark.asyncio
async def test_startup_event_sends_the_machine_facts(posthog):
    await telemetry_service.send_startup_event()

    [call] = posthog.captures
    assert call["event"] == "instance_started"
    assert call["distinct_id"] == str(INSTANCE_ID)
    assert call["properties"] == {
        "instance_id": str(INSTANCE_ID),
        "instance_kind": "production",
        "agenta_version": "v0.129.0",
        "edition": "oss",
        "deployment_method": "compose",
        "instance_host": "agenta.example.com",
        "cpu_count": 8,
        "memory_mb": 32000,
        "memory_limit_mb": 4096,
        "postgres_version": "16.4",
        "$groups": {"instance": str(INSTANCE_ID)},
        "$process_person_profile": False,
    }


@pytest.mark.asyncio
async def test_startup_event_sends_no_url_or_path(posthog):
    await telemetry_service.send_startup_event()

    text = str(posthog.captures[0]).lower()
    assert "https" not in text
    assert "8443" not in text
    assert "/app" not in text


@pytest.mark.asyncio
async def test_switch_off_sends_no_startup_event(monkeypatch, posthog):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    await telemetry_service.send_startup_event()

    assert posthog.captures == []


@pytest.mark.asyncio
async def test_cloud_sends_no_startup_event(monkeypatch, posthog):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_not_a_real_key")

    await telemetry_service.send_startup_event()

    assert posthog.captures == []


@pytest.mark.asyncio
async def test_failed_startup_event_logs_and_does_not_raise(monkeypatch):
    failing = _PostHog(fail=TimeoutError())
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: failing)
    warning = MagicMock()
    monkeypatch.setattr(telemetry_service.log, "warning", warning)

    await telemetry_service.send_startup_event()

    warning.assert_called_once()
    assert warning.call_args.kwargs == {"reason": "TimeoutError"}


@pytest.mark.asyncio
async def test_unknown_postgres_version_is_sent_as_null(monkeypatch, posthog):
    monkeypatch.setattr(
        runtime.instances_dao,
        "fetch_postgres_version",
        AsyncMock(side_effect=OSError("no database")),
    )

    await telemetry_service.send_startup_event()

    assert posthog.captures[0]["properties"]["postgres_version"] is None


@pytest.mark.parametrize(
    "web_url, host",
    [
        ("https://agenta.example.com", "agenta.example.com"),
        ("http://localhost:3000/w", "localhost"),
        ("http://10.0.0.5", "10.0.0.5"),
        ("", None),
    ],
)
def test_instance_host_is_the_host_name_only(monkeypatch, web_url, host):
    monkeypatch.setattr(env.agenta, "web_url", web_url)

    assert runtime.get_instance_host() == host


@pytest.mark.parametrize(
    "content, expected",
    [
        ("4294967296\n", 4096),
        ("max\n", None),
        (str(9223372036854771712), None),
    ],
)
def test_memory_limit_reads_the_cgroup_file(monkeypatch, tmp_path, content, expected):
    limit = tmp_path / "memory.max"
    limit.write_text(content)
    monkeypatch.setattr(runtime, "_MEMORY_LIMIT_FILES", (tmp_path / "none", limit))

    assert _memory_limit_mb() == expected


def test_no_cgroup_file_means_no_memory_limit(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "_MEMORY_LIMIT_FILES", (tmp_path / "none",))

    assert _memory_limit_mb() is None


def test_library_properties_are_dropped_from_the_install_ping_only():
    def message(event):
        return {
            "event": event,
            "properties": {"$lib": "posthog-python", "$os": "Linux", "a": 1},
        }

    strip = telemetry_service._install_ping_without_library_properties
    assert strip(message("instance_installed"))["properties"] == {"a": 1}
    assert strip(message("instance_started"))["properties"] == {
        "$lib": "posthog-python",
        "$os": "Linux",
        "a": 1,
    }
    assert strip(message("instance_heartbeat"))["properties"]["$os"] == "Linux"


def test_the_startup_event_runs_in_the_background(monkeypatch):
    scheduled = []
    monkeypatch.setattr(
        telemetry_service,
        "_run_in_background",
        lambda coroutine: scheduled.append(coroutine),
    )

    telemetry_service.schedule_startup_event()

    [coroutine] = scheduled
    assert coroutine.cr_code is telemetry_service.send_startup_event.__code__
    coroutine.close()

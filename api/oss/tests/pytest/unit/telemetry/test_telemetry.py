"""What leaves a self-hosted instance for PostHog, read from the captured payloads.

PostHog is never reached: the queued client (`_load_posthog`) and the synchronous
client (`_sync_client`) are replaced by recorders.
"""

import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid5

import pytest

from oss.src.core.auth.supertokens import overrides
from oss.src.core.telemetry import service as telemetry_service
from oss.src.middlewares import analytics
from oss.src.utils import lazy
from oss.src.utils.env import env

INSTANCE_ID = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")
USER_ID = UUID("8b2d4f6a-1c3e-4a5b-8d7f-9e0a1b2c3d4e")
EMAIL = "Ada.Lovelace@example.com"
ORGANIZATION_NAME = "Analytical Engines Ltd"


class _Recorder:
    """Stands in for a PostHog client and keeps every capture."""

    def __init__(self, fail: Exception | None = None):
        self.calls = []
        self.fail = fail

    def capture(self, event=None, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.calls.append({"event": event, **kwargs})
        return str(kwargs.get("uuid") or "recorded")


@pytest.fixture
def self_hosted(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", None)
    monkeypatch.setattr(env.telemetry, "enabled", True)
    monkeypatch.setattr(env.telemetry, "enabled_set", False)
    monkeypatch.setattr(
        telemetry_service, "get_instance_id", AsyncMock(return_value=INSTANCE_ID)
    )


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_not_a_real_key")
    monkeypatch.setattr(env.telemetry, "enabled", True)


@pytest.fixture
def queued(monkeypatch):
    """The real `_load_posthog` gate in front of a recording PostHog module."""
    recorder = _Recorder()
    monkeypatch.setattr(lazy, "_import_posthog", lambda: recorder)
    return recorder


@pytest.fixture
def synchronous(monkeypatch):
    recorder = _Recorder()
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: recorder)
    return recorder


@pytest.fixture
def install_row(monkeypatch):
    """The `instances` row lock: yields the id, records whether the send committed."""
    state = SimpleNamespace(committed=False, rolled_back=False, instance_id=INSTANCE_ID)

    @asynccontextmanager
    async def _lock():
        try:
            yield state.instance_id
        except Exception:
            state.rolled_back = True
            raise
        state.committed = state.instance_id is not None

    monkeypatch.setattr(
        telemetry_service.instances_dao, "lock_unsent_install_ping", _lock
    )
    return state


def _request(path="/apps", method="POST", **state):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        method=method,
        headers={"Authorization": "ApiKey abc"},
        cookies={},
        state=SimpleNamespace(**state),
    )


async def _call_next(_request):
    return SimpleNamespace(status_code=200)


def _flatten(value):
    """Every key and string value in a payload, at any depth."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _flatten(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    elif isinstance(value, str):
        yield value


def _assert_no_personal_data(call):
    text = " ".join(_flatten(call)).lower()
    assert EMAIL.lower() not in text
    assert "ada.lovelace" not in text
    assert ORGANIZATION_NAME.lower() not in text
    assert "email" not in text
    assert "username" not in text
    assert "organization_name" not in text
    assert "cloud_url" not in text
    assert "$set" not in call.get("properties", {})


# --- the gate ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_switch_off_closes_the_queued_client(monkeypatch, self_hosted, queued):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    assert await lazy._load_posthog() is None


@pytest.mark.asyncio
async def test_switch_on_opens_the_queued_client(self_hosted, queued):
    assert await lazy._load_posthog() is queued


@pytest.mark.asyncio
async def test_cloud_ignores_the_switch(monkeypatch, cloud, queued):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    assert await telemetry_service.telemetry_enabled() is True
    assert await lazy._load_posthog() is queued


def test_the_built_in_posthog_key_stays():
    assert env.posthog.api_key


# --- switch off: only the install ping leaves -------------------------------


@pytest.mark.asyncio
async def test_switch_off_sends_only_the_install_ping(
    monkeypatch, self_hosted, queued, synchronous, install_row
):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    await analytics.analytics_middleware(
        _request(
            user_email=EMAIL,
            user_id=str(USER_ID),
            organization_name=ORGANIZATION_NAME,
        ),
        _call_next,
    )
    await telemetry_service.send_install_ping()

    assert queued.calls == []
    assert synchronous.calls == [
        {
            "event": "instance_installed",
            "distinct_id": str(INSTANCE_ID),
            "properties": {"$geoip_disable": True, "$ip": ""},
            "uuid": uuid5(INSTANCE_ID, "instance_installed"),
        }
    ]
    assert install_row.committed


@pytest.mark.asyncio
async def test_failed_install_ping_rolls_back_and_does_not_raise(
    monkeypatch, self_hosted, install_row
):
    failing = _Recorder(fail=ConnectionError("no route to host"))
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: failing)
    warning = MagicMock()
    monkeypatch.setattr(telemetry_service.log, "warning", warning)

    await telemetry_service.send_install_ping()

    assert install_row.rolled_back
    assert not install_row.committed
    warning.assert_called_once()


@pytest.fixture
def wire(monkeypatch):
    """The real synchronous PostHog client, with the HTTP post recorded or failing."""
    state = SimpleNamespace(batches=[], fail=None)

    def _batch_post(api_key, host=None, **kwargs):
        if state.fail is not None:
            raise state.fail
        state.batches.append(kwargs["batch"])

    monkeypatch.setattr("posthog.client.batch_post", _batch_post)
    telemetry_service._sync_client.cache_clear()
    yield state
    telemetry_service._sync_client.cache_clear()


@pytest.mark.asyncio
async def test_install_ping_on_the_wire_has_only_its_properties(
    self_hosted, wire, install_row
):
    await telemetry_service.send_install_ping()

    [[message]] = wire.batches
    assert message["event"] == "instance_installed"
    assert message["distinct_id"] == str(INSTANCE_ID)
    assert message["uuid"] == str(uuid5(INSTANCE_ID, "instance_installed"))
    assert message["properties"] == {"$geoip_disable": True, "$ip": ""}
    assert install_row.committed


@pytest.mark.asyncio
async def test_install_ping_the_client_swallows_still_rolls_back(
    self_hosted, wire, install_row
):
    # The PostHog client catches send errors itself and returns None.
    wire.fail = ConnectionError("no route to host")

    await telemetry_service.send_install_ping()

    assert install_row.rolled_back
    assert not install_row.committed


@pytest.mark.asyncio
async def test_install_ping_not_due_sends_nothing(
    self_hosted, synchronous, install_row
):
    install_row.instance_id = None

    await telemetry_service.send_install_ping()

    assert synchronous.calls == []


@pytest.mark.asyncio
async def test_cloud_sends_no_install_ping(cloud, synchronous, install_row):
    await telemetry_service.send_install_ping()

    assert synchronous.calls == []


# --- switch on: anonymous per-user events ----------------------------------


@pytest.mark.asyncio
async def test_self_hosted_event_uses_the_anonymous_id(self_hosted, queued):
    await analytics.analytics_middleware(
        _request(
            user_email=EMAIL,
            user_id=str(USER_ID),
            organization_id="0b8f0e9e-0000-4000-8000-000000000001",
            organization_name=ORGANIZATION_NAME,
        ),
        _call_next,
    )

    [call] = queued.calls
    assert call["event"] == "app_created"
    assert call["distinct_id"] == f"{INSTANCE_ID}:{USER_ID}"
    _assert_no_personal_data(call)


@pytest.mark.asyncio
async def test_self_hosted_activation_uses_the_anonymous_id(
    monkeypatch, self_hosted, queued
):
    monkeypatch.setattr(analytics, "get_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(analytics, "set_cache", AsyncMock())

    await analytics.analytics_middleware(
        _request(
            path="/organizations/x/invite",
            user_email=EMAIL,
            user_id=str(USER_ID),
            project_id="p1",
        ),
        _call_next,
    )

    assert [call["event"] for call in queued.calls] == [
        "user_invitation_sent_v1",
        "$identify",
    ]
    for call in queued.calls:
        assert call["distinct_id"] == f"{INSTANCE_ID}:{USER_ID}"
        _assert_no_personal_data(call)


@pytest.mark.asyncio
async def test_self_hosted_sign_up_has_no_email_or_url(
    monkeypatch, self_hosted, queued
):
    monkeypatch.setattr(
        overrides,
        "ensure_auth_info_not_blocked",
        AsyncMock(side_effect=lambda auth_info: auth_info),
    )
    monkeypatch.setattr(overrides, "get_user_with_email", AsyncMock(return_value=None))
    monkeypatch.setattr(
        overrides,
        "create_accounts",
        AsyncMock(return_value=SimpleNamespace(id=USER_ID, email=EMAIL)),
    )
    monkeypatch.setattr(env.agenta, "web_url", "https://agenta.example.internal")

    assert await overrides._create_account(EMAIL, "uid") is True

    [call] = queued.calls
    assert call["event"] == "user_signed_up_v1"
    assert call["distinct_id"] == f"{INSTANCE_ID}:{USER_ID}"
    assert "agenta.example.internal" not in " ".join(_flatten(call))
    _assert_no_personal_data(call)


# --- cloud: as today --------------------------------------------------------


@pytest.mark.asyncio
async def test_cloud_event_keeps_the_email_identity(cloud, queued):
    await analytics.analytics_middleware(
        _request(
            user_email=EMAIL,
            user_id=str(USER_ID),
            organization_name=ORGANIZATION_NAME,
        ),
        _call_next,
    )

    [call] = queued.calls
    assert call["distinct_id"] == EMAIL
    assert call["properties"]["$set"] == {"email": EMAIL}
    assert call["properties"]["organization_name"] == ORGANIZATION_NAME


@pytest.mark.asyncio
async def test_cloud_sign_up_keeps_the_email_and_url(monkeypatch, cloud, queued):
    monkeypatch.setattr(
        overrides,
        "ensure_auth_info_not_blocked",
        AsyncMock(side_effect=lambda auth_info: auth_info),
    )
    monkeypatch.setattr(overrides, "get_user_with_email", AsyncMock(return_value=None))
    monkeypatch.setattr(
        overrides,
        "create_accounts",
        AsyncMock(return_value=SimpleNamespace(id=USER_ID, email=EMAIL)),
    )
    monkeypatch.setattr(env.agenta, "web_url", "https://cloud.agenta.ai")

    await overrides._create_account(EMAIL, "uid")

    [call] = queued.calls
    assert call["distinct_id"] == EMAIL.lower()
    assert call["properties"]["cloud_url"] == "https://cloud.agenta.ai"
    assert call["properties"]["$set"] == {"email": EMAIL.lower()}


# --- what the browser is told ----------------------------------------------


@pytest.mark.asyncio
async def test_browser_gets_the_anonymous_id_and_group(self_hosted):
    telemetry = await telemetry_service.instance_telemetry_for(USER_ID, EMAIL)

    assert telemetry.model_dump() == {
        "enabled": True,
        "distinct_id": f"{INSTANCE_ID}:{USER_ID}",
        "groups": {"instance": str(INSTANCE_ID)},
    }


@pytest.mark.asyncio
async def test_browser_gets_nothing_when_the_switch_is_off(monkeypatch, self_hosted):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    telemetry = await telemetry_service.instance_telemetry_for(USER_ID, EMAIL)

    assert telemetry.model_dump() == {
        "enabled": False,
        "distinct_id": None,
        "groups": None,
    }


@pytest.mark.asyncio
async def test_browser_on_cloud_gets_the_email(cloud):
    telemetry = await telemetry_service.instance_telemetry_for(USER_ID, EMAIL)

    assert telemetry.model_dump() == {
        "enabled": True,
        "distinct_id": EMAIL,
        "groups": None,
    }


# --- startup log ------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("enabled", "enabled_set", "expected"),
    [
        (True, False, "Telemetry is on (on by default)"),
        (True, True, "Telemetry is on (AGENTA_TELEMETRY_ENABLED)"),
        (False, True, "Telemetry is off (AGENTA_TELEMETRY_ENABLED=false)"),
    ],
)
async def test_startup_log_names_the_reason_and_the_docs(
    monkeypatch, self_hosted, enabled, enabled_set, expected
):
    monkeypatch.setattr(env.telemetry, "enabled", enabled)
    monkeypatch.setattr(env.telemetry, "enabled_set", enabled_set)
    info = MagicMock()
    monkeypatch.setattr(telemetry_service.log, "info", info)

    await telemetry_service.log_telemetry_status()

    [message] = info.call_args.args
    assert message.startswith(expected)
    assert telemetry_service.TELEMETRY_DOCS_URL in message


# --- a paid license key keeps telemetry on ----------------------------------

LICENSE_SERVICE = "ee.src.core.licenses.service"


def _license(plan, telemetry="required"):
    return SimpleNamespace(plan=plan, telemetry=telemetry)


@pytest.fixture
def switch_off_on_ee(monkeypatch, self_hosted):
    monkeypatch.setattr(env.agenta, "license", "ee")
    monkeypatch.setattr(env.telemetry, "enabled", False)
    monkeypatch.setattr(env.telemetry, "enabled_set", True)


def _install_license(monkeypatch, license_key):
    monkeypatch.setitem(
        sys.modules,
        LICENSE_SERVICE,
        SimpleNamespace(active_license=AsyncMock(return_value=license_key)),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "license_key, enabled, reason",
    [
        (_license("self_hosted_enterprise"), True, "license"),
        (_license("self_hosted_enterprise", telemetry="exempt"), False, "switch"),
        (_license("self_hosted_registered"), False, "switch"),
        (None, False, "switch"),
    ],
    ids=["paid", "paid_exempt", "free_registered", "no_key"],
)
async def test_license_and_switch_off(
    monkeypatch, switch_off_on_ee, license_key, enabled, reason
):
    _install_license(monkeypatch, license_key)

    status = await telemetry_service.telemetry_status()

    assert (status.enabled, status.reason) == (enabled, reason)


@pytest.mark.asyncio
@pytest.mark.parametrize("switch", [True, False])
async def test_no_license_module_gives_the_switch(monkeypatch, self_hosted, switch):
    monkeypatch.setattr(env.agenta, "license", "ee")
    monkeypatch.setattr(env.telemetry, "enabled", switch)
    monkeypatch.setattr(env.telemetry, "enabled_set", True)
    # None in sys.modules makes the import raise ImportError, as a missing module does.
    monkeypatch.setitem(sys.modules, LICENSE_SERVICE, None)

    assert await telemetry_service.telemetry_enabled() is switch


@pytest.mark.asyncio
async def test_oss_never_reads_a_license(monkeypatch, self_hosted):
    monkeypatch.setattr(env.agenta, "license", "oss")
    monkeypatch.setattr(env.telemetry, "enabled", False)
    active_license = AsyncMock(return_value=_license("self_hosted_enterprise"))
    monkeypatch.setitem(
        sys.modules, LICENSE_SERVICE, SimpleNamespace(active_license=active_license)
    )

    assert await telemetry_service.telemetry_enabled() is False
    active_license.assert_not_awaited()


@pytest.mark.asyncio
async def test_paid_license_opens_the_browser_and_the_queued_client(
    monkeypatch, switch_off_on_ee, queued
):
    _install_license(monkeypatch, _license("self_hosted_enterprise"))

    answer = await telemetry_service.instance_telemetry_for(USER_ID, EMAIL)

    assert answer.enabled is True
    assert answer.distinct_id == f"{INSTANCE_ID}:{USER_ID}"
    assert answer.groups == {"instance": str(INSTANCE_ID)}
    assert await lazy._load_posthog() is not None


@pytest.mark.asyncio
async def test_startup_log_names_the_license(monkeypatch, switch_off_on_ee):
    _install_license(monkeypatch, _license("self_hosted_enterprise"))
    info = MagicMock()
    monkeypatch.setattr(telemetry_service.log, "info", info)

    await telemetry_service.log_telemetry_status()

    [message] = info.call_args.args
    assert message.startswith("Telemetry is on (required by the license key)")


# --- the docs page lists every field the API sends -------------------------


@pytest.mark.asyncio
async def test_docs_list_every_api_event_field(monkeypatch, self_hosted, queued):
    from oss.tests.pytest.unit.telemetry._docs import documented_fields

    monkeypatch.setattr(analytics, "get_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(analytics, "set_cache", AsyncMock())
    monkeypatch.setattr(
        overrides,
        "ensure_auth_info_not_blocked",
        AsyncMock(side_effect=lambda auth_info: auth_info),
    )
    monkeypatch.setattr(overrides, "get_user_with_email", AsyncMock(return_value=None))
    monkeypatch.setattr(
        overrides,
        "create_accounts",
        AsyncMock(return_value=SimpleNamespace(id=USER_ID, email=EMAIL)),
    )

    await analytics.analytics_middleware(
        _request(
            path="/organizations/x/invite",
            user_email=EMAIL,
            user_id=str(USER_ID),
            project_id="p1",
            workspace_id="w1",
            organization_id="o1",
            organization_name=ORGANIZATION_NAME,
        ),
        _call_next,
    )
    await overrides._create_account(EMAIL, "uid")

    documented = documented_fields("Product events from the API")
    sent = set()
    for call in queued.calls:
        if call["event"] == "$identify":
            sent |= set(call["properties"]["$set_once"])
        else:
            sent |= {call["event"], *call["properties"]}
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"

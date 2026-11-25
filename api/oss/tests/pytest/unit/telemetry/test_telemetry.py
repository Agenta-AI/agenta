"""What leaves a self-hosted instance for PostHog, read from the captured payloads.

PostHog is never reached: the queued client (`_load_posthog`) and the synchronous
client (`_sync_client`) are replaced by recorders.
"""

import warnings
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid5

import pytest

from oss.src.core.auth.supertokens import overrides
from oss.src.core.instances import service as instances_service
from oss.src.core.telemetry import service as telemetry_service
from oss.src.middlewares import analytics
from oss.src.utils import env as env_module
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
    monkeypatch.setattr(env.telemetry, "instance_kind", "test")
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


def _request(path="/apps", method="POST", headers=None, **state):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        method=method,
        headers={"Authorization": "ApiKey abc", **(headers or {})},
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
    # The one person property a self-hosted event may set is the user's role.
    assert set(call.get("properties", {}).get("$set", {})) <= {"role"}


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
            "properties": {
                "$geoip_disable": True,
                "$ip": "",
                "$process_person_profile": False,
            },
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
    assert message["properties"] == {
        "$geoip_disable": True,
        "$ip": "",
        "$process_person_profile": False,
    }
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
    assert "cloud_region" not in call["properties"]
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


@pytest.mark.asyncio
async def test_self_hosted_event_carries_the_version_and_sets_the_role(
    monkeypatch, self_hosted, queued
):
    monkeypatch.setattr(analytics, "get_agenta_version", lambda: "v0.129.0")
    monkeypatch.setattr(analytics, "_request_role", AsyncMock(return_value="editor"))

    await analytics.analytics_middleware(
        _request(user_email=EMAIL, user_id=str(USER_ID), project_id="p1"),
        _call_next,
    )

    [call] = queued.calls
    assert call["properties"]["agenta_version"] == "v0.129.0"
    assert call["properties"]["$set"] == {"role": "editor"}
    _assert_no_personal_data(call)


@pytest.mark.asyncio
async def test_self_hosted_event_without_a_role_sets_nothing(self_hosted, queued):
    # No memberships service in a unit test: the lookup fails and sets no role.
    await analytics.analytics_middleware(
        _request(user_email=EMAIL, user_id=str(USER_ID), project_id="p1"),
        _call_next,
    )

    [call] = queued.calls
    assert "$set" not in call["properties"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "membership, expected",
    [
        (None, None),
        (SimpleNamespace(is_organization_owner=True, role="admin"), "owner"),
        (SimpleNamespace(is_organization_owner=False, role="viewer"), "viewer"),
    ],
)
async def test_role_comes_from_the_cached_membership(monkeypatch, membership, expected):
    service = SimpleNamespace(resolve=AsyncMock(return_value=membership))
    monkeypatch.setattr(analytics, "get_memberships_service", lambda: service)

    role = await analytics._request_role(
        _request(user_id=str(USER_ID), project_id=str(INSTANCE_ID))
    )

    assert role == expected
    service.resolve.assert_awaited_once_with(user_id=USER_ID, project_id=INSTANCE_ID)


@pytest.mark.parametrize(
    "headers, expected",
    [
        (
            {"x-fern-sdk-name": "agenta", "x-fern-sdk-version": "0.70.1"},
            {"sdk_name": "agenta", "sdk_version": "0.70.1"},
        ),
        (
            {"user-agent": "python-httpx/0.28.1"},
            {"sdk_name": "python-httpx", "sdk_version": "0.28.1"},
        ),
        (
            {"user-agent": "OTel-OTLP-Exporter-Python/1.30.0"},
            {"sdk_name": "OTel-OTLP-Exporter-Python", "sdk_version": "1.30.0"},
        ),
        ({"user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0"}, {}),
        ({"user-agent": "curl"}, {}),
        ({"user-agent": "person@example.com/1.0"}, {}),
        ({"user-agent": "tool/alice.smith+x@corp.com"}, {}),
        ({"x-fern-sdk-name": "person@example.com", "x-fern-sdk-version": "1"}, {}),
        (
            {
                "x-fern-sdk-name": "agenta",
                "x-fern-sdk-version": "1.0 person@example.com",
            },
            {"sdk_name": "agenta"},
        ),
        ({}, {}),
    ],
)
def test_sdk_name_and_version_come_from_the_client_headers(headers, expected):
    assert analytics._client_sdk(_request(headers=headers)) == expected


@pytest.mark.asyncio
async def test_self_hosted_api_event_carries_the_instance_kind(self_hosted, queued):
    await analytics.analytics_middleware(
        _request(user_email=EMAIL, user_id=str(USER_ID)), _call_next
    )

    [call] = queued.calls
    assert call["properties"]["instance_kind"] == "test"


@pytest.mark.asyncio
async def test_cloud_api_event_has_no_instance_kind(cloud, queued):
    await analytics.analytics_middleware(
        _request(user_email=EMAIL, user_id=str(USER_ID)), _call_next
    )

    [call] = queued.calls
    assert "instance_kind" not in call["properties"]


@pytest.mark.parametrize(
    "role, expected",
    [
        ("editor", "editor"),
        ("ops-lead", "ops-lead"),
        ("operators@example.com", "custom"),
        ("a role with spaces", "custom"),
    ],
)
def test_role_names_are_sent_only_when_plain(role, expected):
    assert telemetry_service.role_label(role) == expected


@pytest.mark.parametrize(
    "override, ci, web_url, expected",
    [
        ("test", False, "https://agenta.example.com", "test"),
        ("production", True, "http://localhost", "production"),
        (None, True, "https://agenta.example.com", "ci"),
        (None, False, "http://localhost:3000", "development"),
        (None, False, "https://agenta.example.com", "production"),
    ],
)
def test_instance_kind_override_wins_over_detection(
    monkeypatch, override, ci, web_url, expected
):
    monkeypatch.setattr(env.telemetry, "instance_kind", override)
    monkeypatch.setattr(env.telemetry, "ci", ci)
    monkeypatch.setattr(env.agenta, "web_url", web_url)

    assert instances_service.get_instance_kind() == expected


@pytest.mark.parametrize(
    "value, expected",
    [("test", "test"), (" CI ", "ci"), ("", None), ("staging", None)],
)
def test_instance_kind_env_var_accepts_the_known_values(monkeypatch, value, expected):
    monkeypatch.setenv("AGENTA_TELEMETRY_INSTANCE_KIND", value)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        assert env_module._parse_instance_kind() == expected


@pytest.mark.asyncio
async def test_api_event_carries_the_sdk_that_called(self_hosted, queued):
    await analytics.analytics_middleware(
        _request(
            user_email=EMAIL,
            user_id=str(USER_ID),
            headers={"user-agent": "python-httpx/0.28.1"},
        ),
        _call_next,
    )

    [call] = queued.calls
    assert call["properties"]["sdk_name"] == "python-httpx"
    assert call["properties"]["sdk_version"] == "0.28.1"


@pytest.mark.asyncio
async def test_sign_up_carries_the_version(monkeypatch, self_hosted, queued):
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
    monkeypatch.setattr(overrides, "get_agenta_version", lambda: "v0.129.0")

    await overrides._create_account(EMAIL, "uid")

    [call] = queued.calls
    assert call["properties"]["agenta_version"] == "v0.129.0"


# --- cloud: the user id is the person, every event names its deployment -----

CLOUD_URL = "https://us.cloud.agenta.ai"


@pytest.mark.asyncio
async def test_cloud_event_uses_the_user_id_and_keeps_the_email_as_a_property(
    monkeypatch, cloud, queued
):
    monkeypatch.setattr(env.agenta, "web_url", CLOUD_URL)

    await analytics.analytics_middleware(
        _request(
            user_email=EMAIL,
            user_id=str(USER_ID),
            organization_name=ORGANIZATION_NAME,
        ),
        _call_next,
    )

    [call] = queued.calls
    assert call["distinct_id"] == str(USER_ID)
    assert call["properties"]["$set"] == {"email": EMAIL}
    assert call["properties"]["organization_name"] == ORGANIZATION_NAME
    assert call["properties"]["cloud_region"] == "US"
    assert call["properties"]["cloud_url"] == CLOUD_URL
    assert "$process_person_profile" not in call["properties"]


@pytest.mark.asyncio
async def test_cloud_activation_uses_the_user_id_and_names_the_deployment(
    monkeypatch, cloud, queued
):
    monkeypatch.setattr(env.agenta, "web_url", CLOUD_URL)
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
        assert call["distinct_id"] == str(USER_ID)
        assert call["properties"]["cloud_region"] == "US"
        assert call["properties"]["cloud_url"] == CLOUD_URL


@pytest.mark.asyncio
async def test_activation_mark_cache_is_keyed_by_the_distinct_id(
    monkeypatch, cloud, queued
):
    # A mark cached under the old email identity must not stop the mark on the user id.
    get_cache = AsyncMock(return_value=None)
    set_cache = AsyncMock()
    monkeypatch.setattr(analytics, "get_cache", get_cache)
    monkeypatch.setattr(analytics, "set_cache", set_cache)

    await analytics.analytics_middleware(
        _request(
            path="/organizations/x/invite",
            user_email=EMAIL,
            user_id=str(USER_ID),
            project_id="p1",
        ),
        _call_next,
    )

    activation_reads = [
        call.kwargs["key"]
        for call in get_cache.await_args_list
        if call.kwargs.get("namespace") == "posthog:activations"
    ]
    assert activation_reads == [
        {"property": "invited_user_v1", "distinct_id": str(USER_ID)}
    ]
    assert set_cache.await_args.kwargs["key"] == activation_reads[0]


@pytest.mark.asyncio
async def test_cloud_sign_up_uses_the_user_id_and_keeps_the_email_and_url(
    monkeypatch, cloud, queued
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
    monkeypatch.setattr(env.agenta, "web_url", "https://cloud.agenta.ai")

    await overrides._create_account(EMAIL, "uid")

    [call] = queued.calls
    assert call["distinct_id"] == str(USER_ID)
    assert call["properties"]["cloud_url"] == "https://cloud.agenta.ai"
    assert call["properties"]["cloud_region"] == "EU"
    assert call["properties"]["$set"] == {"email": EMAIL.lower()}


@pytest.mark.parametrize(
    ("url", "region"),
    [
        ("https://cloud.agenta.ai", "EU"),
        ("https://eu.cloud.agenta.ai", "EU"),
        ("https://us.cloud.agenta.ai", "US"),
        ("https://staging.preview.agenta.dev", "EU"),
        ("https://testing.preview.agenta.dev", "US"),
        ("us.cloud.agenta.ai", "US"),
        ("https://agenta.example.internal", "Other"),
        ("", "Other"),
    ],
)
def test_cloud_region_comes_from_the_web_url(url, region):
    assert telemetry_service.cloud_region(url) == region


def test_self_hosted_events_get_no_cloud_properties(monkeypatch, self_hosted):
    monkeypatch.setattr(env.agenta, "web_url", CLOUD_URL)

    assert telemetry_service.cloud_event_properties() == {}


# --- what the browser is told ----------------------------------------------


@pytest.mark.asyncio
async def test_browser_gets_the_anonymous_id_and_group(self_hosted):
    telemetry = await telemetry_service.instance_telemetry_for(USER_ID)

    assert telemetry.model_dump() == {
        "enabled": True,
        "distinct_id": f"{INSTANCE_ID}:{USER_ID}",
        "groups": {"instance": str(INSTANCE_ID)},
        "properties": {"instance_kind": "test"},
    }


@pytest.mark.asyncio
async def test_browser_gets_nothing_when_the_switch_is_off(monkeypatch, self_hosted):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    telemetry = await telemetry_service.instance_telemetry_for(USER_ID)

    assert telemetry.model_dump() == {
        "enabled": False,
        "distinct_id": None,
        "groups": None,
        "properties": None,
    }


@pytest.mark.asyncio
async def test_browser_on_cloud_gets_the_user_id_and_the_deployment(monkeypatch, cloud):
    monkeypatch.setattr(env.agenta, "web_url", CLOUD_URL)

    telemetry = await telemetry_service.instance_telemetry_for(USER_ID)

    assert telemetry.model_dump() == {
        "enabled": True,
        "distinct_id": str(USER_ID),
        "groups": None,
        "properties": {"cloud_region": "US", "cloud_url": CLOUD_URL},
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
    monkeypatch.setattr(analytics, "_request_role", AsyncMock(return_value="editor"))

    await analytics.analytics_middleware(
        _request(
            path="/organizations/x/invite",
            headers={"user-agent": "python-httpx/0.28.1"},
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

"""The telemetry heartbeat, read from what would reach PostHog.

PostHog and the database are never reached: the synchronous client and the
`instances` DAO are replaced by fakes. The fake row lock follows the real one: a
caller that finds the row locked, or already sent, gets False.
"""

import asyncio
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid5

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from oss.src.core.telemetry import heartbeat, runtime
from oss.src.dbs.postgres.instances import dao as instances_dao_module
from oss.src.core.telemetry import service as telemetry_service
from oss.src.utils.env import env
from oss.tests.pytest.unit.telemetry._license_key import without_license_key

INSTANCE_ID = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")
LICENSE_KEY_ID = UUID("0b6c2e7d-8a4f-4c1e-9d3b-5f7a9c1e3b5d")
CREATED_AT = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)
EMAILS = ["ada@example.com", "grace@navy.example.org"]

CONTRACT_FIELDS = {
    "instance_id",
    "instance_kind",
    "agenta_version",
    "edition",
    "deployment_method",
    "instance_host",
    "cpu_count",
    "memory_mb",
    "memory_limit_mb",
    "postgres_version",
    "plan",
    "license_key_id",
    "license_expires_at",
    "license_days_left",
    "license_seats",
    "email_configured",
    "sso_configured",
    "social_login_configured",
    "otel_export_configured",
    "composio_configured",
    "llm_gateway_enabled",
    "timezone",
    "total_organizations",
    "total_projects",
    "total_users",
    "total_workflows",
    "total_prompts",
    "total_agents",
    "total_evaluators",
    "total_snippets",
    "total_api_keys",
    "users_by_role",
    "window_start",
    "window_end",
    "window_spans",
    "window_traces",
    "window_annotations",
    "window_evaluation_runs",
    "window_evaluation_runs_by_status",
    "window_evaluation_scenarios",
    "window_agent_turns",
    "window_agent_turns_by_outcome",
    "window_revisions",
    "window_deployments",
    "window_testsets",
    "window_testcases",
    "user_domains",
}

# The autouse fixture replaces it; the config flag test calls the real one.
_real_config_flags = heartbeat._config_flags

CONFIG_FLAGS = heartbeat.ConfigFlags(
    email_configured=True,
    sso_configured=False,
    social_login_configured=True,
    otel_export_configured=False,
    composio_configured=False,
    llm_gateway_enabled=True,
    timezone="UTC",
)


class _PostHog:
    """Like the real sync client: a send returns the event uuid, or None when PostHog
    did not accept it."""

    def __init__(self, fail: Exception | None = None, group_accepted: bool = True):
        self.captures = []
        self.groups = []
        self.fail = fail
        self.group_accepted = group_accepted

    def capture(self, event=None, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.captures.append({"event": event, **kwargs})
        return str(kwargs.get("uuid"))

    def group_identify(self, group_type, group_key, properties):
        if not self.group_accepted:
            return None
        self.groups.append((group_type, group_key, properties))
        return "group-uuid"


class _InstancesDAO:
    """The `instances` row and the collector queries, in memory."""

    def __init__(self):
        self.heartbeat_sent_at = None
        self.now = datetime(2026, 11, 9, 20, 0, tzinfo=timezone.utc)
        self.locked = asyncio.Lock()
        self.domain_rows = [("example.com", 3), ("navy.example.org", 1)]
        self.collected = 0

    def _due(self):
        return self.heartbeat_sent_at is None or self.heartbeat_sent_at < (
            self.now - timedelta(hours=6)
        )

    async def fetch_due_heartbeat_window(self):
        if not self._due():
            return None
        return INSTANCE_ID, self.heartbeat_sent_at, CREATED_AT, self.now

    @asynccontextmanager
    async def lock_due_heartbeat(self, *, heartbeat_sent_at, window_end):
        if self.locked.locked():
            yield False  # SKIP LOCKED
            return
        async with self.locked:
            if not self._due() or self.heartbeat_sent_at != heartbeat_sent_at:
                yield False
                return
            yield True
            self.heartbeat_sent_at = window_end

    async def count_totals(self):
        self.collected += 1
        return 2, 3, 4, 5, [UUID(int=1), UUID(int=2)]

    async def count_workflow_kinds(self):
        return 1, 2, 1, 1

    async def count_window_session_turns(self, *, window_start, window_end):
        return 7

    async def count_window_workflow_revisions(self, *, window_start, window_end):
        return 9

    async def count_window_environment_revisions(self, *, window_start, window_end):
        return 10

    async def count_window_spans(self, *, project_ids, window_start, window_end):
        return 8

    async def count_window_traces(self, *, project_ids, window_start, window_end):
        return 11, 3

    async def count_window_evaluation_runs_by_status(self, *, window_start, window_end):
        return {"success": 5, "failure": 1}

    async def count_window_agent_turns_by_outcome(self, *, window_start, window_end):
        return {"completed": 6, "failed": 1}

    async def count_window_evaluation_scenarios(self, *, window_start, window_end):
        return 12

    async def count_window_testsets(self, *, window_start, window_end):
        return 2

    async def count_window_testcases(self, *, window_start, window_end):
        return 40

    async def count_api_keys(self):
        return 3

    async def count_users_by_role(self):
        return {"owner": 2, "editor": 2}

    async def has_organization_sso_providers(self):
        return False

    async def top_email_domains(self, *, limit):
        return self.domain_rows[:limit]


@pytest.fixture
def dao(monkeypatch):
    fake = _InstancesDAO()
    monkeypatch.setattr(heartbeat, "instances_dao", fake)
    return fake


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
    without_license_key(monkeypatch)
    monkeypatch.setattr(env.agenta, "web_url", "https://agenta.example.com")
    monkeypatch.setattr(runtime, "get_agenta_version", lambda: "v0.128.11")
    monkeypatch.setattr(runtime.os, "cpu_count", lambda: 8)
    monkeypatch.setattr(runtime, "_memory_mb", lambda: 32000)
    monkeypatch.setattr(runtime, "_memory_limit_mb", lambda: None)
    monkeypatch.setattr(runtime, "_postgres_version", AsyncMock(return_value="16.4"))
    monkeypatch.setattr(
        heartbeat, "_config_flags", AsyncMock(return_value=CONFIG_FLAGS)
    )


def _flatten(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _flatten(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten(item)
    elif isinstance(value, str):
        yield value


@pytest.mark.asyncio
async def test_payload_has_exactly_the_contract_fields(dao, posthog):
    assert await heartbeat.send_heartbeat() == "sent"

    (call,) = posthog.captures
    properties = call["properties"]
    assert call["event"] == "instance_heartbeat"
    assert call["distinct_id"] == str(INSTANCE_ID)
    assert set(properties) == CONTRACT_FIELDS | {"$groups"}
    assert set(heartbeat.InstanceHeartbeat.model_fields) == CONTRACT_FIELDS
    assert properties["$groups"] == {"instance": str(INSTANCE_ID)}
    assert properties == {
        "instance_id": str(INSTANCE_ID),
        "instance_kind": "production",
        "agenta_version": "v0.128.11",
        "edition": "ee",
        "deployment_method": "compose",
        "instance_host": "agenta.example.com",
        "cpu_count": 8,
        "memory_mb": 32000,
        "memory_limit_mb": None,
        "postgres_version": "16.4",
        "plan": "self_hosted_community",
        "license_key_id": None,
        "license_expires_at": None,
        "license_days_left": None,
        "license_seats": None,
        "email_configured": True,
        "sso_configured": False,
        "social_login_configured": True,
        "otel_export_configured": False,
        "composio_configured": False,
        "llm_gateway_enabled": True,
        "timezone": "UTC",
        "total_organizations": 2,
        "total_projects": 3,
        "total_users": 4,
        "total_workflows": 5,
        "total_prompts": 1,
        "total_agents": 2,
        "total_evaluators": 1,
        "total_snippets": 1,
        "total_api_keys": 3,
        "users_by_role": {"owner": 2, "editor": 2},
        "window_start": "2026-11-01T08:00:00+00:00",
        "window_end": "2026-11-09T20:00:00+00:00",
        "window_spans": 8,
        "window_traces": 11,
        "window_annotations": 3,
        "window_evaluation_runs": 6,
        "window_evaluation_runs_by_status": {"success": 5, "failure": 1},
        "window_evaluation_scenarios": 12,
        "window_agent_turns": 7,
        "window_agent_turns_by_outcome": {"completed": 6, "failed": 1},
        "window_revisions": 9,
        "window_deployments": 10,
        "window_testsets": 2,
        "window_testcases": 40,
        "user_domains": [
            {"domain": "example.com", "users": 3},
            {"domain": "navy.example.org", "users": 1},
        ],
        "$groups": {"instance": str(INSTANCE_ID)},
    }
    assert call["uuid"] == uuid5(INSTANCE_ID, "2026-11-01T08:00:00+00:00")


@pytest.mark.asyncio
async def test_payload_has_no_email_url_or_ip(dao, posthog):
    await heartbeat.send_heartbeat()

    properties = posthog.captures[0]["properties"]
    text = " ".join(_flatten(posthog.captures[0])).lower()
    for email in EMAILS:
        assert email not in text
    assert "@" not in text
    assert "http" not in text
    # The host name is the one part of the web address that is sent.
    assert properties["instance_host"] == "agenta.example.com"
    assert text.count("agenta.example.com") == 1
    assert "$ip" not in text
    assert "email" not in text.replace("email_configured", "")


@pytest.mark.asyncio
async def test_group_properties_come_from_the_heartbeat(dao, posthog):
    await heartbeat.send_heartbeat()

    assert posthog.groups == [
        (
            "instance",
            str(INSTANCE_ID),
            {
                "instance_kind": "production",
                "agenta_version": "v0.128.11",
                "edition": "ee",
                "deployment_method": "compose",
                "instance_host": "agenta.example.com",
                "postgres_version": "16.4",
                "plan": "self_hosted_community",
                "license_expires_at": None,
                "license_seats": None,
                "total_organizations": 2,
                "total_projects": 3,
                "total_users": 4,
                "total_workflows": 5,
                "total_prompts": 1,
                "total_agents": 2,
                "total_evaluators": 1,
                "total_snippets": 1,
                "total_api_keys": 3,
            },
        )
    ]


@pytest.mark.asyncio
async def test_second_call_within_6_hours_sends_nothing(dao, posthog):
    assert await heartbeat.send_heartbeat() == "sent"
    dao.now += timedelta(hours=5)

    assert await heartbeat.send_heartbeat() == "not_due"
    assert len(posthog.captures) == 1


@pytest.mark.asyncio
async def test_next_window_starts_where_the_last_one_ended(dao, posthog):
    await heartbeat.send_heartbeat()
    first_end = posthog.captures[0]["properties"]["window_end"]
    dao.now += timedelta(days=3)

    assert await heartbeat.send_heartbeat() == "sent"
    second = posthog.captures[1]
    assert second["properties"]["window_start"] == first_end
    assert second["uuid"] == uuid5(INSTANCE_ID, first_end)


@pytest.mark.asyncio
async def test_gate_off_sends_nothing(monkeypatch, dao, posthog):
    monkeypatch.setattr(env.telemetry, "enabled", False)

    assert await heartbeat.send_heartbeat() == "disabled"
    assert posthog.captures == []
    assert dao.collected == 0
    assert dao.heartbeat_sent_at is None


@pytest.mark.asyncio
async def test_stripe_on_sends_nothing(monkeypatch, dao, posthog):
    monkeypatch.setattr(env.stripe, "api_key", "sk_test_not_a_real_key")

    assert await heartbeat.send_heartbeat() == "cloud"
    assert posthog.captures == []
    assert dao.collected == 0


@pytest.mark.asyncio
async def test_failed_send_rolls_back(monkeypatch, dao):
    failing = _PostHog(fail=TimeoutError())
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: failing)

    assert await heartbeat.send_heartbeat() == "failed"
    assert dao.heartbeat_sent_at is None
    assert failing.groups == []


@pytest.mark.asyncio
async def test_refused_group_properties_keep_the_sent_window(monkeypatch, dao):
    """PostHog has the event, so the window is committed. A retry under the same uuid
    with a later end would be dropped by PostHog and lose the usage in between."""

    refusing = _PostHog(group_accepted=False)
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: refusing)

    assert await heartbeat.send_heartbeat() == "sent"
    assert dao.heartbeat_sent_at == dao.now
    assert len(refusing.captures) == 1
    assert refusing.groups == []

    dao.now += timedelta(hours=7)
    accepting = _PostHog()
    monkeypatch.setattr(telemetry_service, "_sync_client", lambda timeout: accepting)

    assert await heartbeat.send_heartbeat() == "sent"
    assert (
        accepting.captures[0]["properties"]["window_start"]
        == (refusing.captures[0]["properties"]["window_end"])
    )
    assert accepting.captures[0]["uuid"] != refusing.captures[0]["uuid"]
    assert len(accepting.groups) == 1


@pytest.mark.asyncio
async def test_two_concurrent_callers_send_once(monkeypatch, dao):
    """Both callers collect; the first takes the lock and holds it during the send,
    the second skips the locked row."""

    sends = []
    release = asyncio.Event()

    async def _slow_capture(event, distinct_id, properties, **kwargs):
        sends.append(properties["window_start"])
        await release.wait()

    monkeypatch.setattr(heartbeat.telemetry, "capture", _slow_capture)
    monkeypatch.setattr(heartbeat.telemetry, "group_identify", AsyncMock())

    first = asyncio.create_task(heartbeat.send_heartbeat())
    while not sends:
        await asyncio.sleep(0)
    second = await heartbeat.send_heartbeat()
    release.set()

    assert await first == "sent"
    assert second == "not_due"
    assert len(sends) == 1


@pytest.mark.asyncio
async def test_caller_that_read_an_old_window_sends_nothing(dao, posthog):
    """A caller that collected before another container committed must not send."""

    due = await dao.fetch_due_heartbeat_window()
    await heartbeat.send_heartbeat()

    async with dao.lock_due_heartbeat(
        heartbeat_sent_at=due[1], window_end=dao.now
    ) as locked:
        assert locked is False


LICENSE_SERVICE = "ee.src.core.licenses.service"


@pytest.mark.asyncio
async def test_ee_reads_plan_and_license_key_id(monkeypatch, dao, posthog):
    monkeypatch.setitem(
        sys.modules,
        LICENSE_SERVICE,
        SimpleNamespace(
            active_license=AsyncMock(
                return_value=SimpleNamespace(
                    key_id=LICENSE_KEY_ID,
                    customer="Analytical Engines Ltd",
                    plan="self_hosted_enterprise",
                    seats=25,
                    expires_at=datetime(2026, 12, 9, 20, 0, tzinfo=timezone.utc),
                )
            ),
        ),
    )

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    assert properties["edition"] == "ee"
    assert properties["plan"] == "self_hosted_enterprise"
    assert properties["license_key_id"] == str(LICENSE_KEY_ID)
    assert properties["license_expires_at"] == "2026-12-09T20:00:00+00:00"
    assert properties["license_days_left"] == 30
    assert properties["license_seats"] == 25
    assert "Analytical Engines" not in str(properties)


@pytest.mark.asyncio
async def test_ee_without_the_license_module_sends_the_plan_with_no_key(
    monkeypatch, dao, posthog
):
    # None in sys.modules makes the import raise ImportError, as a missing module does.
    monkeypatch.setitem(sys.modules, LICENSE_SERVICE, None)

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    assert properties["edition"] == "ee"
    assert properties["plan"] == "self_hosted_community"
    assert properties["license_key_id"] is None


@pytest.mark.asyncio
async def test_a_count_past_its_timeout_is_sent_as_null(monkeypatch, dao, posthog):
    monkeypatch.setattr(dao, "count_window_session_turns", AsyncMock(return_value=None))
    monkeypatch.setattr(
        dao, "count_window_workflow_revisions", AsyncMock(return_value=None)
    )

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    assert properties["window_agent_turns"] is None
    assert properties["window_revisions"] is None
    assert properties["window_evaluation_runs"] == 6
    assert properties["window_deployments"] == 10


@pytest.mark.asyncio
async def test_workflow_kinds_past_their_timeout_are_sent_as_null(
    monkeypatch, dao, posthog
):
    monkeypatch.setattr(dao, "count_workflow_kinds", AsyncMock(return_value=None))

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    assert properties["total_workflows"] == 5
    for name in ("total_prompts", "total_agents", "total_evaluators", "total_snippets"):
        assert properties[name] is None


def test_domains_hold_domains_only():
    rows = [
        ("example.org", 50),
        ("", 40),
        ("two words.com", 30),
        ("ada@example.com", 20),
        ("example.net", 10),
    ]

    domains = heartbeat.user_domains_from(rows)

    assert [domain.model_dump() for domain in domains] == [
        {"domain": "example.org", "users": 50},
        {"domain": "example.net", "users": 10},
    ]


@pytest.mark.asyncio
async def test_model_refuses_more_than_100_domains_or_an_email(dao, posthog):
    await heartbeat.send_heartbeat()
    base = dict(posthog.captures[0]["properties"])
    del base["$groups"], base["user_domains"]

    with pytest.raises(ValidationError):
        heartbeat.InstanceHeartbeat(
            **base,
            user_domains=[{"domain": f"d{n}.example", "users": 1} for n in range(101)],
        )
    with pytest.raises(ValidationError):
        heartbeat.InstanceHeartbeat(
            **base, user_domains=[{"domain": "ada@example.com", "users": 1}]
        )


@pytest.mark.asyncio
async def test_route_answers_with_the_reason(monkeypatch):
    from oss.src.apis.fastapi.telemetry import router as telemetry_router

    monkeypatch.setattr(
        telemetry_router, "send_heartbeat", AsyncMock(return_value="not_due")
    )
    response = await telemetry_router.TelemetryRouter().send_telemetry_heartbeat()

    assert response.model_dump() == {"sent": False, "reason": "not_due"}


class _PostgresError(Exception):
    def __init__(self, message, sqlstate):
        super().__init__(message)
        self.sqlstate = sqlstate


class _Executor:
    def __init__(self, error):
        self.error = error
        self.statements = []

    async def execute(self, statement, params=None):
        self.statements.append(str(statement))
        if params is not None:
            raise DBAPIError(str(statement), params, self.error)


def _scope(executor):
    @asynccontextmanager
    async def scope():
        yield executor

    return scope


@pytest.mark.asyncio
async def test_count_past_the_statement_timeout_gives_none():
    executor = _Executor(
        _PostgresError("canceling statement due to statement timeout", "57014")
    )

    count = await instances_dao_module._count_or_none(
        _scope(executor), text("SELECT count(*) FROM session_turns"), {}
    )

    assert count is None
    assert "statement_timeout" in executor.statements[0]


@pytest.mark.asyncio
async def test_workflow_kinds_past_the_statement_timeout_give_none():
    executor = _Executor(
        _PostgresError("canceling statement due to statement timeout", "57014")
    )

    kinds = await instances_dao_module._row_or_none(
        _scope(executor), text(instances_dao_module._WORKFLOW_KINDS_SQL), {}
    )

    assert kinds is None
    assert "statement_timeout" in executor.statements[0]
    assert "is_agent" in executor.statements[1]


@pytest.mark.asyncio
async def test_count_with_another_database_error_raises():
    executor = _Executor(_PostgresError('relation "x" does not exist', "42P01"))

    with pytest.raises(DBAPIError):
        await instances_dao_module._count_or_none(
            _scope(executor), text("SELECT count(*) FROM x"), {}
        )


@pytest.mark.asyncio
async def test_grouped_counts_past_their_timeout_are_sent_as_null(
    monkeypatch, dao, posthog
):
    for name in (
        "count_window_evaluation_runs_by_status",
        "count_window_agent_turns_by_outcome",
        "count_users_by_role",
        "count_window_traces",
        "count_api_keys",
    ):
        monkeypatch.setattr(dao, name, AsyncMock(return_value=None))

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    for name in (
        "window_evaluation_runs",
        "window_evaluation_runs_by_status",
        "window_agent_turns_by_outcome",
        "users_by_role",
        "window_traces",
        "window_annotations",
        "total_api_keys",
    ):
        assert properties[name] is None
    assert properties["window_spans"] == 8


@pytest.mark.asyncio
async def test_config_flags_are_booleans_from_the_settings(monkeypatch, dao):
    monkeypatch.setattr(env.smtp, "host", None)
    monkeypatch.setattr(env.sendgrid, "api_key", "SG.not-a-real-key")
    monkeypatch.setattr(env.sendgrid, "from_email", "noreply@example.com")
    monkeypatch.setattr(env.identity.okta, "client_id", None)
    monkeypatch.setattr(env.identity.github, "client_id", "gh-id")
    monkeypatch.setattr(env.identity.github, "client_secret", "gh-secret")
    monkeypatch.setattr(env.composio, "api_key", None)
    monkeypatch.setattr(env.llm_gateway, "enabled", False)
    monkeypatch.setattr(env.agenta.logging, "otlp_enabled", False)
    monkeypatch.setattr(env.agenta.server_tracing, "endpoint", "http://collector:4318")
    monkeypatch.setattr(
        dao, "has_organization_sso_providers", AsyncMock(return_value=True)
    )

    flags = (await _real_config_flags()).model_dump()

    assert flags["email_configured"] is True
    assert flags["sso_configured"] is True
    assert flags["social_login_configured"] is True
    assert flags["otel_export_configured"] is True
    assert flags["composio_configured"] is False
    assert flags["llm_gateway_enabled"] is False
    text = str(flags)
    for secret in (
        "SG.not-a-real-key",
        "gh-id",
        "gh-secret",
        "collector",
        "example.com",
    ):
        assert secret not in text


def test_a_key_without_an_expiry_has_no_days_left():
    detail = heartbeat._license_detail_from(
        SimpleNamespace(
            key_id=LICENSE_KEY_ID,
            plan="self_hosted_business",
            seats=None,
            expires_at=None,
        ),
        datetime(2026, 11, 9, tzinfo=timezone.utc),
    )

    assert detail.model_dump() == {
        "plan": "self_hosted_business",
        "license_key_id": str(LICENSE_KEY_ID),
        "license_expires_at": None,
        "license_days_left": None,
        "license_seats": None,
    }


@pytest.mark.asyncio
async def test_grouped_count_past_the_statement_timeout_gives_none():
    executor = _Executor(
        _PostgresError("canceling statement due to statement timeout", "57014")
    )

    counts = await instances_dao_module._counts_by_key_or_none(
        _scope(executor),
        text("SELECT status, count(*) FROM evaluation_runs GROUP BY 1"),
        {},
    )

    assert counts is None
    assert "statement_timeout" in executor.statements[0]


def test_the_heartbeat_interval_is_6_hours():
    assert "6 hours" in str(instances_dao_module.HEARTBEAT_INTERVAL)


@pytest.mark.asyncio
async def test_custom_role_names_are_not_sent(monkeypatch, dao, posthog):
    monkeypatch.setattr(
        dao,
        "count_users_by_role",
        AsyncMock(
            return_value={"owner": 1, "operators@example.com": 2, "on call team": 3}
        ),
    )

    assert await heartbeat.send_heartbeat() == "sent"

    properties = posthog.captures[0]["properties"]
    assert properties["users_by_role"] == {"owner": 1, "custom": 5}
    assert "operators@" not in str(properties)

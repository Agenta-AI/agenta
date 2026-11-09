"""The telemetry heartbeat, read from what would reach PostHog.

PostHog and the database are never reached: the synchronous client and the
`instances` DAO are replaced by fakes. The fake row lock follows the real one: a
caller that finds the row locked, or already sent, gets False.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import UUID, uuid5

import pytest
from pydantic import ValidationError

from oss.src.core.telemetry import heartbeat
from oss.src.core.telemetry import service as telemetry_service
from oss.src.utils.env import env

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
    "plan",
    "license_key_id",
    "total_organizations",
    "total_projects",
    "total_users",
    "total_workflows",
    "window_start",
    "window_end",
    "window_spans",
    "window_evaluation_runs",
    "window_agent_turns",
    "user_domains",
}


class _PostHog:
    def __init__(self, fail: Exception | None = None):
        self.captures = []
        self.groups = []
        self.fail = fail

    def capture(self, event=None, **kwargs):
        if self.fail is not None:
            raise self.fail
        self.captures.append({"event": event, **kwargs})

    def group_identify(self, group_type, group_key, properties):
        self.groups.append((group_type, group_key, properties))


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
            self.now - timedelta(hours=12)
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

    async def count_window(self, *, window_start, window_end):
        return 6, 7

    async def count_window_spans(self, *, project_ids, window_start, window_end):
        return 8

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
    monkeypatch.setattr(env.agenta, "license", "oss")
    monkeypatch.setattr(env.agenta, "web_url", "https://agenta.example.com")
    monkeypatch.setattr(heartbeat, "get_agenta_version", lambda: "v0.128.11")


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
        "edition": "oss",
        "deployment_method": "compose",
        "plan": "self_hosted_community",
        "license_key_id": None,
        "total_organizations": 2,
        "total_projects": 3,
        "total_users": 4,
        "total_workflows": 5,
        "window_start": "2026-11-01T08:00:00+00:00",
        "window_end": "2026-11-09T20:00:00+00:00",
        "window_spans": 8,
        "window_evaluation_runs": 6,
        "window_agent_turns": 7,
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

    text = " ".join(_flatten(posthog.captures[0])).lower()
    for email in EMAILS:
        assert email not in text
    assert "@" not in text
    assert "http" not in text
    assert "agenta.example.com" not in text
    assert "$ip" not in text
    assert "email" not in text


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
                "edition": "oss",
                "deployment_method": "compose",
                "plan": "self_hosted_community",
                "total_organizations": 2,
                "total_projects": 3,
                "total_users": 4,
                "total_workflows": 5,
            },
        )
    ]


@pytest.mark.asyncio
async def test_second_call_within_12_hours_sends_nothing(dao, posthog):
    assert await heartbeat.send_heartbeat() == "sent"
    dao.now += timedelta(hours=11)

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


@pytest.mark.asyncio
async def test_ee_reads_plan_and_license_key_id(monkeypatch, dao, posthog):
    monkeypatch.setattr(env.agenta, "license", "ee")
    monkeypatch.setattr(
        heartbeat,
        "_plan_and_license_key_id",
        AsyncMock(return_value=("self_hosted_enterprise", str(LICENSE_KEY_ID))),
    )

    await heartbeat.send_heartbeat()

    properties = posthog.captures[0]["properties"]
    assert properties["edition"] == "ee"
    assert properties["plan"] == "self_hosted_enterprise"
    assert properties["license_key_id"] == str(LICENSE_KEY_ID)


def test_domains_are_capped_at_100_and_hold_domains_only():
    rows = [
        ("Ada@Example.com", 50),
        ("", 40),
        ("two words.com", 30),
        ("Example.ORG", 20),
    ] + [(f"d{n}.example.net", 1) for n in range(200)]

    domains = heartbeat.user_domains_from(rows)

    assert len(domains) == 100
    assert domains[0].model_dump() == {"domain": "example.org", "users": 20}
    assert all("@" not in domain.domain for domain in domains)
    assert all(set(domain.model_dump()) == {"domain", "users"} for domain in domains)


def test_model_refuses_more_than_100_domains_or_an_email():
    base = dict(
        instance_id=str(INSTANCE_ID),
        instance_kind="production",
        agenta_version="v0.128.11",
        edition="oss",
        deployment_method=None,
        plan="self_hosted_community",
        license_key_id=None,
        total_organizations=0,
        total_projects=0,
        total_users=0,
        total_workflows=0,
        window_start="2026-11-01T08:00:00+00:00",
        window_end="2026-11-09T20:00:00+00:00",
        window_spans=0,
        window_evaluation_runs=0,
        window_agent_turns=0,
    )

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

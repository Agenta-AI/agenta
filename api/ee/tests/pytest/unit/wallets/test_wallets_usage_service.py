"""The usage view joins debits to their measurements and groups them; asserted by value
against in-memory reads."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from ee.src.core.wallets.types import WalletBalanceDTO, WalletSpendableBalanceDTO
from ee.src.core.wallets.usage import service as usage_service
from ee.src.core.wallets.usage.dtos import (
    MeasurementUsage,
    WalletCreditUsage,
    WalletUsageDebit,
)
from ee.src.core.wallets.usage.service import WalletUsageService, category_of

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
ORG = uuid4()
USER = uuid4()
AGENT = uuid4()
PROJECT = uuid4()


class _Wallets:
    async def get_general_balance(self, *, organization_id):
        return WalletBalanceDTO(
            id=uuid4(), organization_id=organization_id, balance_musd=900, floor_musd=0
        )

    async def get_spendable_balance(self, *, organization_id):
        return WalletSpendableBalanceDTO(
            organization_id=organization_id, spendable_musd=800, floor_musd=0
        )


class _Usage:
    def __init__(self, debits=(), credits=()):
        self.debits = list(debits)
        self.credits = list(credits)
        self.limit = None

    async def list_credits(self, *, organization_id):
        return self.credits

    async def list_usage_debits(self, *, organization_id, start, end, limit):
        self.limit = limit
        return self.debits[:limit]

    async def user_emails(self, *, user_ids):
        return {USER: "user@example.com"} if USER in set(user_ids) else {}

    async def agent_names(self, *, agents):
        key = (PROJECT, AGENT)
        return {key: "Support agent"} if key in set(agents) else {}


class _Measurements:
    def __init__(self, measurements=()):
        self.measurements = {m.measurement_id: m for m in measurements}

    async def fetch_measurements(self, *, measurement_ids):
        return {
            i: self.measurements[i] for i in measurement_ids if i in self.measurements
        }


def _debit(mid, amount, *, at, resource_key="llm:agenta:gpt-5.5"):
    return WalletUsageDebit(
        idempotency_key=f"measurement:{mid}",
        amount_musd=amount,
        resource_key=resource_key,
        resource_locator={"provider": "agenta", "model": "gpt-5.5"},
        pricing_version="rc-1",
        created_at=at,
    )


def _measurement(mid, *, session=None, agent_id=None, references=None):
    refs = dict(references or {})
    if session:
        refs["session"] = {"id": session}
    return MeasurementUsage(
        measurement_id=mid,
        project_id=PROJECT,
        user_id=USER,
        agent_id=agent_id,
        references=refs,
        components={"input_tokens": 10, "output_tokens": 3, "request_count": 1},
    )


def _service(debits=(), measurements=(), credits=()):
    return WalletUsageService(
        wallets_dao=_Wallets(),
        usage_dao=_Usage(debits, credits),
        measurements_dao=_Measurements(measurements),
    )


def test_categories_follow_the_resource_key_plane():
    assert category_of("llm:agenta:gpt-5.5") == "Model calls"
    assert category_of("mcp:agenta:search") == "Tools"
    assert category_of("sbx:daytona:cpu") == "Sandbox"
    assert category_of("plan_change") == "Other"


async def test_charges_group_by_session_newest_first_with_names_and_tokens():
    service = _service(
        debits=[
            _debit("m3", 7, at=NOW),
            _debit("m2", 5, at=NOW - timedelta(minutes=5)),
            _debit("m1", 3, at=NOW - timedelta(hours=1)),
        ],
        measurements=[
            _measurement("m3", session="s-new", agent_id=AGENT),
            _measurement("m2", session="s-old", agent_id=AGENT),
            _measurement("m1", session="s-old"),
        ],
    )

    usage = await service.usage(organization_id=ORG, end=NOW + timedelta(seconds=1))

    assert [s.session_id for s in usage.sessions] == ["s-new", "s-old"]
    newest, oldest = usage.sessions
    assert (newest.amount_musd, newest.charge_count) == (7, 1)
    assert (oldest.amount_musd, oldest.charge_count) == (8, 2)
    assert oldest.agent_id == AGENT and oldest.agent_name == "Support agent"
    assert oldest.user_email == "user@example.com"
    assert [c.measurement_id for c in oldest.charges] == ["m2", "m1"]
    assert (oldest.started_at, oldest.last_at) == (
        NOW - timedelta(hours=1),
        NOW - timedelta(minutes=5),
    )
    charge = newest.charges[0]
    assert (charge.input_tokens, charge.output_tokens, charge.request_count) == (
        10,
        3,
        1,
    )
    assert (charge.model, charge.pricing_version) == ("gpt-5.5", "rc-1")


async def test_unlabelled_charges_group_per_user_and_day():
    yesterday = NOW - timedelta(days=1)
    service = _service(
        debits=[
            _debit("a", 1, at=NOW),
            _debit("b", 2, at=NOW - timedelta(minutes=1)),
            _debit("c", 4, at=yesterday),
            _debit("d", 8, at=NOW - timedelta(minutes=2)),  # no measurement found
        ],
        measurements=[_measurement("a"), _measurement("b"), _measurement("c")],
    )

    usage = await service.usage(organization_id=ORG, end=NOW + timedelta(seconds=1))

    assert {(s.session_id, s.user_id, s.amount_musd) for s in usage.sessions} == {
        (None, USER, 3),
        (None, USER, 4),
        (None, None, 8),
    }
    assert sum(s.amount_musd for s in usage.sessions) == 15


async def test_daily_totals_split_by_category_and_match_the_debits():
    service = _service(
        debits=[
            _debit("a", 10, at=NOW),
            _debit("b", 20, at=NOW, resource_key="mcp:agenta:search"),
            _debit("c", 30, at=NOW - timedelta(days=1)),
        ]
    )

    usage = await service.usage(organization_id=ORG, end=NOW + timedelta(seconds=1))

    assert [(d.day.isoformat(), d.category, d.amount_musd) for d in usage.days] == [
        ("2026-09-25", "Model calls", 30),
        ("2026-09-26", "Model calls", 10),
        ("2026-09-26", "Tools", 20),
    ]


async def test_the_window_is_capped_and_says_so(monkeypatch):
    monkeypatch.setattr(usage_service, "MAX_DEBITS", 2)
    service = _service(
        debits=[_debit(str(i), 1, at=NOW - timedelta(minutes=i)) for i in range(3)]
    )

    usage = await service.usage(organization_id=ORG, end=NOW + timedelta(seconds=1))

    assert usage.truncated is True
    assert sum(s.charge_count for s in usage.sessions) == 2


async def test_summary_totals_only_the_credits_active_now():
    now = datetime.now(timezone.utc)
    credits = [
        WalletCreditUsage(
            id=uuid4(),
            credit_kind="signup_grant",
            amount_musd=1_000,
            remaining_musd=400,
            priority=20,
            end_time=now + timedelta(days=1),
        ),
        WalletCreditUsage(
            id=uuid4(),
            credit_kind="goodwill",
            amount_musd=5_000,
            remaining_musd=5_000,
            priority=30,
        ),
        WalletCreditUsage(
            id=uuid4(),
            credit_kind="promotion",
            amount_musd=9_000,
            remaining_musd=9_000,
            priority=30,
            end_time=now - timedelta(days=1),
        ),
    ]

    summary = await _service(credits=credits).summary(organization_id=ORG)

    assert (summary.spendable_musd, summary.general_balance_musd) == (800, 900)
    assert summary.active_credit_total_musd == 6_000
    assert len(summary.credits) == 3


async def test_a_sandbox_interval_shows_under_sandbox_with_its_seconds_and_resources():
    debit = WalletUsageDebit(
        idempotency_key="measurement:sbx:p:daytona:sb-1:1790000000",
        amount_musd=4140,
        resource_key="sbx:daytona",
        resource_locator={
            "provider": "daytona",
            "sandbox_id": "sb-1",
            "vcpu": 2,
            "memory_gib": 4,
        },
        pricing_version="rc-1",
        created_at=NOW,
    )
    measurement = MeasurementUsage(
        measurement_id="sbx:p:daytona:sb-1:1790000000",
        project_id=PROJECT,
        user_id=USER,
        agent_id=AGENT,
        references={"session": {"id": "s-1"}},
        components={
            "sandbox_seconds": 60,
            "vcpu_seconds": 120,
            "memory_gib_seconds": 240,
        },
    )
    service = _service(debits=[debit], measurements=[measurement])

    usage = await service.usage(organization_id=ORG, end=NOW + timedelta(seconds=1))

    [session] = usage.sessions
    assert (session.session_id, session.agent_name) == ("s-1", "Support agent")
    [charge] = session.charges
    assert charge.category == "Sandbox"
    assert (charge.sandbox_seconds, charge.vcpu, charge.memory_gib) == (60, 2, 4)
    assert (charge.provider, charge.model, charge.input_tokens) == (
        "daytona",
        None,
        None,
    )
    assert [(d.category, d.amount_musd) for d in usage.days] == [("Sandbox", 4140)]

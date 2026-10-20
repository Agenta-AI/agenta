"""Unit tests for the credit-farming fraud check: the `fraud-check` flag defaults, the
Jev HTTP call (mocked at the transport), both check points, and fail-open."""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional
from uuid import UUID, uuid4

import httpx
import pytest
import uuid_utils.compat as uuid_utils

import ee.src.core.fraud.config as fraud_config
import ee.src.core.fraud.jev as fraud_jev
import ee.src.core.fraud.service as fraud_service_module
import ee.src.core.organizations.service as organizations_service_module
from ee.src.core.fraud.service import FraudService
from ee.src.core.fraud.types import (
    HOLD_FLOOR_MUSD,
    POLICY,
    ApiKeySignals,
    FraudCheckConfig,
    FraudCheckMode,
    FraudCheckpoint,
    FraudDAOInterface,
)
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.types import WalletBalanceDTO
from oss.src.utils.env import env
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _typesafe_configured(monkeypatch):
    monkeypatch.setattr(env.typesafe, "api_key", "test-key")
    monkeypatch.setattr(env.typesafe, "api_url", "https://jev.test")


@pytest.fixture
def flag(monkeypatch):
    """Serve a `fraud-check` payload from a fake PostHog client. `None` means the flag
    is missing; an exception instance means the lookup fails."""

    def _serve(payload):
        def _get_feature_flag_payload(feature_flag, distinct_id):
            if isinstance(payload, Exception):
                raise payload
            return payload

        monkeypatch.setattr(
            fraud_config,
            "_load_posthog",
            lambda: SimpleNamespace(get_feature_flag_payload=_get_feature_flag_payload),
        )

    _serve(None)
    return _serve


class _JevStub:
    """A mocked TypeSafe API behind `httpx.MockTransport`. `answer` is the noul
    probability to return, an `httpx.HTTPError` to raise, or an int HTTP status."""

    def __init__(self):
        self.answer = 0.0
        self.requests = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if isinstance(self.answer, Exception):
            raise self.answer
        if isinstance(self.answer, int) and not isinstance(self.answer, bool):
            return httpx.Response(self.answer, json={"detail": "boom"})
        return httpx.Response(
            200,
            json={
                "model": "jev-1.13.0",
                "answers": {"fraud": {"type": "noul", "noul": self.answer}},
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )


@pytest.fixture
def jev(monkeypatch):
    stub = _JevStub()
    monkeypatch.setattr(
        fraud_jev,
        "_build_client",
        lambda: httpx.AsyncClient(
            base_url=env.typesafe.api_url,
            transport=httpx.MockTransport(stub.handler),
        ),
    )
    return stub


class FakeFraudDAO(FraudDAOInterface):
    def __init__(self, signals: Optional[ApiKeySignals] = None):
        self.signals = signals
        self.marks = []
        self.blocked = set()

    async def read_api_key_signals(self, *, user_id, project_id, now):
        return self.signals

    async def mark_no_grants(self, *, organization_id, checkpoint, score, now):
        self.marks.append((organization_id, checkpoint, score))
        self.blocked.add(organization_id)

    async def grants_blocked(self, *, organization_id):
        return organization_id in self.blocked


ORGANIZATION_ID = UUID("00000000-0000-0000-0000-00000000aaaa")


def _signals() -> ApiKeySignals:
    return ApiKeySignals(
        organization_id=ORGANIZATION_ID,
        email="qzxvbn@mail-drop.example",
        account_age_seconds=12,
        first_api_key_seconds_after_signup=12,
        same_domain_signups_24h=40,
        orgs_owned=1,
    )


def _wallets_service() -> WalletsService:
    general = WalletBalanceDTO(
        id=uuid_utils.uuid7(),
        organization_id=ORGANIZATION_ID,
        balance_musd=500_000,
        floor_musd=0,
    )
    return WalletsService(wallets_dao=FakeWalletsDAO(general_balance=general))


@pytest.fixture
def service():
    dao = FakeFraudDAO(signals=_signals())
    svc = FraudService(fraud_dao=dao, wallets_service=_wallets_service())
    return svc


# ---------------------------------------------------------------------------
# flag defaults
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_missing_gives_enforce_defaults(flag):
    config = await fraud_config.read_fraud_check_config()
    assert config == FraudCheckConfig(
        mode=FraudCheckMode.ENFORCE, signup_threshold=0.8, apikey_threshold=0.9
    )


@pytest.mark.asyncio
async def test_flag_lookup_failure_gives_defaults(flag):
    flag(RuntimeError("posthog down"))
    assert (await fraud_config.read_fraud_check_config()) == FraudCheckConfig()


@pytest.mark.asyncio
async def test_flag_malformed_gives_defaults(flag):
    flag("not json")
    assert (await fraud_config.read_fraud_check_config()) == FraudCheckConfig()
    flag({"mode": "enforce", "signup_threshold": "high"})
    assert (await fraud_config.read_fraud_check_config()) == FraudCheckConfig()


@pytest.mark.asyncio
async def test_flag_payload_is_honoured_as_dict_or_json_string(flag):
    flag({"mode": "off", "signup_threshold": 0.5, "apikey_threshold": 0.6})
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.OFF
    assert (config.signup_threshold, config.apikey_threshold) == (0.5, 0.6)

    flag(json.dumps({"signup_threshold": 0.7}))
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.ENFORCE
    assert (config.signup_threshold, config.apikey_threshold) == (0.7, 0.9)


@pytest.mark.asyncio
async def test_posthog_unavailable_gives_defaults(monkeypatch):
    monkeypatch.setattr(fraud_config, "_load_posthog", lambda: None)
    assert (await fraud_config.read_fraud_check_config()) == FraudCheckConfig()


# ---------------------------------------------------------------------------
# the Jev call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ask_noul_sends_one_noul_question_and_reads_the_probability(jev):
    jev.answer = 0.93
    score = await fraud_jev.ask_noul(state={"a": 1}, question="Is it?")
    assert score == 0.93
    (request,) = jev.requests
    assert request == {
        "model": "jev-latest",
        "state": {"a": 1},
        "questions": {"fraud": {"type": "noul", "instructions": "Is it?"}},
    }


@pytest.mark.asyncio
async def test_ask_noul_sends_bearer_auth(monkeypatch):
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200, json={"answers": {"fraud": {"type": "noul", "noul": 0.1}}}
        )

    real_build = fraud_jev._build_client
    monkeypatch.setattr(
        fraud_jev,
        "_build_client",
        lambda: httpx.AsyncClient(
            base_url=env.typesafe.api_url,
            headers=real_build().headers,
            transport=httpx.MockTransport(handler),
        ),
    )
    assert await fraud_jev.ask_noul(state="x", question="q") == 0.1
    assert seen["auth"] == "Bearer test-key"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer",
    [httpx.ReadTimeout("slow"), httpx.ConnectError("down"), 500, 401, "not a number"],
)
async def test_ask_noul_returns_none_on_any_failure(jev, answer):
    jev.answer = answer
    assert await fraud_jev.ask_noul(state="x", question="q") is None


@pytest.mark.asyncio
async def test_ask_noul_without_api_key_makes_no_request(jev, monkeypatch):
    monkeypatch.setattr(env.typesafe, "api_key", None)
    assert await fraud_jev.ask_noul(state="x", question="q") is None
    assert jev.requests == []


# ---------------------------------------------------------------------------
# signup check point
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_signup_at_threshold_skips_grants_and_marks_organization(
    service, flag, jev
):
    jev.answer = 0.8
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="qzxvbn@mail-drop.example"
    )
    assert verdict.flagged is True
    assert verdict.action == "skip_grants"
    assert verdict.domain == "mail-drop.example"
    assert verdict.threshold == 0.8
    assert service.fraud_dao.marks == [(ORGANIZATION_ID, FraudCheckpoint.SIGNUP, 0.8)]
    (request,) = jev.requests
    assert request["state"] == {
        "policy": POLICY,
        "signup": {"email": "qzxvbn@mail-drop.example"},
    }
    assert request["questions"]["fraud"]["instructions"].endswith(
        "Judge from the email address alone."
    )


@pytest.mark.asyncio
async def test_signup_below_threshold_allows(service, flag, jev):
    jev.answer = 0.79
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="jane@company.example"
    )
    assert verdict.flagged is False
    assert verdict.action == "allow"
    assert service.fraud_dao.marks == []


@pytest.mark.asyncio
async def test_signup_fails_open_when_jev_times_out(service, flag, jev):
    jev.answer = httpx.ReadTimeout("slow")
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="qzxvbn@mail-drop.example"
    )
    assert verdict.flagged is False
    assert verdict.score is None
    assert service.fraud_dao.marks == []


@pytest.mark.asyncio
async def test_signup_mode_off_makes_no_request(service, flag, jev):
    flag({"mode": "off"})
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="qzxvbn@mail-drop.example"
    )
    assert verdict.flagged is False
    assert verdict.action == "off"
    assert jev.requests == []


@pytest.mark.asyncio
async def test_signup_threshold_comes_from_the_flag(service, flag, jev):
    flag({"signup_threshold": 0.95})
    jev.answer = 0.9
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="qzxvbn@mail-drop.example"
    )
    assert verdict.flagged is False
    assert verdict.threshold == 0.95


@pytest.mark.asyncio
async def test_signup_seam_allows_when_service_is_not_registered(monkeypatch):
    monkeypatch.setattr(fraud_service_module, "_fraud_service", None)
    assert (
        await fraud_service_module.signup_is_fraud(
            organization_id=ORGANIZATION_ID, email="a@b.example"
        )
        is False
    )


@pytest.mark.asyncio
async def test_signup_seam_allows_when_check_raises(monkeypatch, flag):
    class _Broken(FakeFraudDAO):
        async def mark_no_grants(self, **kwargs):
            raise RuntimeError("db down")

    svc = FraudService(fraud_dao=_Broken(), wallets_service=_wallets_service())
    monkeypatch.setattr(fraud_service_module, "_fraud_service", svc)

    async def _flagged(**kwargs):
        return 0.99

    monkeypatch.setattr(fraud_service_module, "ask_noul", _flagged)
    assert (
        await fraud_service_module.signup_is_fraud(
            organization_id=ORGANIZATION_ID, email="a@b.example"
        )
        is False
    )


@pytest.mark.asyncio
async def test_provision_signup_subscription_skips_grant_when_flagged(monkeypatch):
    """The organization and its balance row are created as normal; only the signup
    grant is withheld."""
    monkeypatch.setattr(env.wallets, "enabled", True)
    calls = []

    async def _allowed(organization_email):
        return True, False

    async def _fraud(*, organization_id, email):
        calls.append(("fraud", organization_id, email))
        return True

    async def _provision(*, organization_id, plan, floor_musd=None):
        calls.append(("provision", floor_musd))

    async def _award(*, organization_id):
        calls.append(("award", organization_id))

    class _FakeSubscription:
        plan = "cloud_v0_hobby"

    class _FakeSubscriptionService:
        async def provision_subscription(self, **kwargs):
            return _FakeSubscription()

    async def _no_entitlements(*, key, delta, scope):
        return None

    async def _no_seed(**kwargs):
        return None

    m = organizations_service_module
    monkeypatch.setattr(m, "_free_credits_check", _allowed)
    monkeypatch.setattr(m, "signup_is_fraud", _fraud)
    monkeypatch.setattr(m, "_provision_wallet_general_balance", _provision)
    monkeypatch.setattr(m, "_award_signup_grant", _award)
    monkeypatch.setattr(m, "_subscription_service", _FakeSubscriptionService())
    monkeypatch.setattr(m, "check_entitlements", _no_entitlements)
    monkeypatch.setattr(m, "seed_starter_credits_bridge_safely", _no_seed)

    organization = SimpleNamespace(id=ORGANIZATION_ID, name="acme")
    await m.provision_signup_subscription(
        organization, organization_email="qzxvbn@mail-drop.example"
    )

    assert calls == [
        ("fraud", ORGANIZATION_ID, "qzxvbn@mail-drop.example"),
        ("provision", None),
    ]


# ---------------------------------------------------------------------------
# API key check point
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_key_at_threshold_holds_wallet_and_marks_organization(
    service, flag, jev
):
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)

    jev.answer = 0.9
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is True
    assert verdict.action == "hold_wallet"
    assert verdict.threshold == 0.9
    assert service.fraud_dao.marks == [(ORGANIZATION_ID, FraudCheckpoint.API_KEY, 0.9)]

    balance = await service.wallets_service.wallets_dao.get_general_balance(
        organization_id=ORGANIZATION_ID
    )
    assert balance.floor_musd == HOLD_FLOOR_MUSD
    assert not await service.wallets_service.check(organization_id=ORGANIZATION_ID)

    (request,) = jev.requests
    assert request["state"]["policy"] == POLICY
    assert request["state"]["signup"] == {
        "email": "qzxvbn@mail-drop.example",
        "account_age_seconds": 12,
        "first_api_key_seconds_after_signup": 12,
        "same_domain_signups_24h": 40,
        "orgs_owned": 1,
    }
    assert (
        request["questions"]["fraud"]["instructions"]
        == "Is `signup` part of a credit-farming fraud ring?"
    )


@pytest.mark.asyncio
async def test_api_key_below_threshold_leaves_wallet_alone(service, flag, jev):
    jev.answer = 0.89
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is False
    assert service.fraud_dao.marks == []
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)


@pytest.mark.asyncio
async def test_api_key_fails_open_when_jev_errors(service, flag, jev):
    jev.answer = 503
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is False
    assert verdict.score is None
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)


@pytest.mark.asyncio
async def test_api_key_mode_off_makes_no_request(service, flag, jev):
    flag({"mode": "off"})
    assert (
        await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
        is None
    )
    assert jev.requests == []


@pytest.mark.asyncio
async def test_api_key_already_marked_organization_is_not_rescored(service, flag, jev):
    service.fraud_dao.blocked.add(ORGANIZATION_ID)
    assert (
        await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
        is None
    )
    assert jev.requests == []


@pytest.mark.asyncio
async def test_api_key_unknown_user_or_project_is_allowed(flag, jev):
    svc = FraudService(
        fraud_dao=FakeFraudDAO(signals=None), wallets_service=_wallets_service()
    )
    assert await svc.check_api_key_creation(user_id=uuid4(), project_id=uuid4()) is None
    assert jev.requests == []


@pytest.mark.asyncio
async def test_api_key_seam_never_raises(monkeypatch, flag):
    class _Broken(FakeFraudDAO):
        async def read_api_key_signals(self, **kwargs):
            raise RuntimeError("db down")

    svc = FraudService(fraud_dao=_Broken(), wallets_service=_wallets_service())
    monkeypatch.setattr(fraud_service_module, "_fraud_service", svc)
    await fraud_service_module.check_api_key_creation(
        user_id=str(uuid4()), project_id=str(uuid4())
    )

    monkeypatch.setattr(fraud_service_module, "_fraud_service", None)
    await fraud_service_module.check_api_key_creation(
        user_id=str(uuid4()), project_id=str(uuid4())
    )


# ---------------------------------------------------------------------------
# the no-grant marker and the daily free credits
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_grant_honours_the_no_grant_marker():
    blocked = {ORGANIZATION_ID}

    async def _plan(organization_id):
        return "cloud_v0_hobby"

    async def _blocked(organization_id):
        return organization_id in blocked

    dao = FakeWalletsDAO(
        general_balance=WalletBalanceDTO(
            id=uuid_utils.uuid7(),
            organization_id=ORGANIZATION_ID,
            balance_musd=0,
            floor_musd=0,
        )
    )
    svc = WalletsService(
        wallets_dao=dao, plan_reader=_plan, grants_blocked_reader=_blocked
    )
    await svc._grant_daily_free_credits_now(
        organization_id=ORGANIZATION_ID, now=datetime.now(timezone.utc)
    )
    assert dao.award_calls == 0

    blocked.clear()
    svc._daily_done = set()
    await svc._grant_daily_free_credits_now(
        organization_id=ORGANIZATION_ID, now=datetime.now(timezone.utc)
    )
    assert dao.award_calls == 1


@pytest.mark.asyncio
async def test_hold_expires_live_credits_and_keeps_expired_ones(monkeypatch):
    from ee.src.core.wallets.types import CreditCandidateDTO

    now = datetime.now(timezone.utc)
    general = WalletBalanceDTO(
        id=uuid_utils.uuid7(),
        organization_id=ORGANIZATION_ID,
        balance_musd=100,
        floor_musd=0,
    )

    def _credit(end_time):
        credit_id = uuid_utils.uuid7()
        candidate = CreditCandidateDTO(
            wallet_credit_id=credit_id,
            credit_kind="signup",
            priority=1,
            end_time=end_time,
            balance_musd=50,
        )
        balance = WalletBalanceDTO(
            id=uuid_utils.uuid7(),
            organization_id=ORGANIZATION_ID,
            wallet_credit_id=credit_id,
            balance_musd=50,
        )
        return candidate, balance

    live = _credit(now + timedelta(days=10))
    already_expired = _credit(now - timedelta(days=1))
    dao = FakeWalletsDAO(general_balance=general, credits=[live, already_expired])
    svc = WalletsService(wallets_dao=dao)

    expired = await svc.hold(
        organization_id=ORGANIZATION_ID, floor_musd=HOLD_FLOOR_MUSD, now=now
    )
    assert expired == 1
    assert dao._credits[live[0].wallet_credit_id][0].end_time == now
    assert dao.general_balance.floor_musd == HOLD_FLOOR_MUSD

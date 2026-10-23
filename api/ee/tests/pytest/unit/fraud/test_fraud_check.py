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
    DEFAULT_APIKEY_THRESHOLD,
    DEFAULT_POLICY,
    DEFAULT_SIGNUP_THRESHOLD,
    ApiKeySignals,
    BillingFacts,
    FraudCheckConfig,
    FraudCheckMode,
    FraudCheckpoint,
    FraudDAOInterface,
)
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.types import CreditCandidateDTO, WalletBalanceDTO
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
    probability to return, an `httpx.HTTPError` to raise, or an int HTTP status (100 or
    more)."""

    def __init__(self):
        self.answer = 0.0
        self.requests = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if isinstance(self.answer, Exception):
            raise self.answer
        if (
            isinstance(self.answer, int)
            and not isinstance(self.answer, bool)
            and self.answer >= 100
        ):
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
        self.billing = BillingFacts(plan="cloud_v0_hobby")

    async def read_api_key_signals(self, *, user_id, project_id, now):
        return self.signals

    async def mark_no_grants(self, *, organization_id, checkpoint, score, now):
        self.marks.append((organization_id, checkpoint, score))
        self.blocked.add(organization_id)

    async def grants_blocked(self, *, organization_id):
        return organization_id in self.blocked

    async def owner_grants_blocked(self, *, owner_id):
        return False

    async def read_billing_facts(self, *, organization_id):
        return self.billing


ORGANIZATION_ID = UUID("00000000-0000-0000-0000-00000000aaaa")


def _signals() -> ApiKeySignals:
    return ApiKeySignals(
        organization_id=ORGANIZATION_ID,
        owns_organization=True,
        email="qzxvbn@mail-drop.example",
        account_age_seconds=12,
        first_api_key_seconds_after_signup=12,
        same_domain_signups_24h=40,
        orgs_owned=1,
    )


def _credit(*, credit_kind: str, balance_musd: int, end_time: Optional[datetime]):
    credit_id = uuid_utils.uuid7()
    candidate = CreditCandidateDTO(
        wallet_credit_id=credit_id,
        credit_kind=credit_kind,
        priority=1,
        end_time=end_time,
        balance_musd=balance_musd,
    )
    balance = WalletBalanceDTO(
        id=uuid_utils.uuid7(),
        organization_id=ORGANIZATION_ID,
        wallet_credit_id=credit_id,
        balance_musd=balance_musd,
    )
    return candidate, balance


def _wallets_service(*credits) -> WalletsService:
    """A wallet whose general balance is the sum of `credits`; one live signup grant of
    500,000 musd by default."""
    if not credits:
        credits = (
            _credit(
                credit_kind="signup_grant",
                balance_musd=500_000,
                end_time=datetime.now(timezone.utc) + timedelta(days=300),
            ),
        )
    general = WalletBalanceDTO(
        id=uuid_utils.uuid7(),
        organization_id=ORGANIZATION_ID,
        balance_musd=sum(balance.balance_musd for _, balance in credits),
        floor_musd=0,
    )
    return WalletsService(
        wallets_dao=FakeWalletsDAO(general_balance=general, credits=list(credits))
    )


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
        mode=FraudCheckMode.ENFORCE,
        signup_threshold=DEFAULT_SIGNUP_THRESHOLD,
        apikey_threshold=DEFAULT_APIKEY_THRESHOLD,
        policy=DEFAULT_POLICY,
    )


@pytest.mark.asyncio
async def test_flag_lookup_failure_turns_the_check_off(flag):
    flag(RuntimeError("posthog down"))
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.OFF


@pytest.mark.asyncio
async def test_flag_malformed_turns_the_check_off(flag):
    flag("not json")
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.OFF
    # A typo in an `off` payload must not switch enforcement on.
    flag({"mode": "of"})
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.OFF


@pytest.mark.asyncio
async def test_flag_payload_is_honoured_as_dict_or_json_string(flag):
    flag({"mode": "off", "signup_threshold": 0.5, "apikey_threshold": 0.6})
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.OFF
    assert (config.signup_threshold, config.apikey_threshold) == (0.5, 0.6)

    flag(json.dumps({"signup_threshold": 0.7}))
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.ENFORCE
    assert (config.signup_threshold, config.apikey_threshold) == (
        0.7,
        DEFAULT_APIKEY_THRESHOLD,
    )


class _LogStub:
    def __init__(self):
        self.warnings = []

    def warning(self, message, **fields):
        self.warnings.append((message, fields))


@pytest.fixture
def config_log(monkeypatch):
    stub = _LogStub()
    monkeypatch.setattr(fraud_config, "log", stub)
    monkeypatch.setattr(fraud_config, "_last_invalid", None)
    return stub


@pytest.mark.asyncio
async def test_flag_payload_policy_is_used(flag):
    flag({"mode": "enforce", "policy": "A policy from the flag."})
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.ENFORCE
    assert config.policy == "A policy from the flag."


@pytest.mark.asyncio
async def test_flag_payload_without_policy_gives_the_default_policy(flag, config_log):
    flag({"mode": "enforce", "signup_threshold": 0.5})
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.ENFORCE
    assert config.policy == DEFAULT_POLICY
    assert config.signup_threshold == 0.5
    assert config_log.warnings == []


@pytest.mark.parametrize("policy", ["", "   ", 42, None, ["a"], {"text": "a"}, True])
@pytest.mark.asyncio
async def test_flag_payload_malformed_policy_gives_the_default_policy(
    flag, config_log, policy
):
    flag({"mode": "enforce", "policy": policy, "apikey_threshold": 0.6})
    config = await fraud_config.read_fraud_check_config()
    # The check stays on, and the other fields are kept.
    assert config.mode == FraudCheckMode.ENFORCE
    assert config.policy == DEFAULT_POLICY
    assert config.apikey_threshold == 0.6
    (warning,) = config_log.warnings
    assert warning[1]["fields"] == ["policy"]


@pytest.mark.parametrize(
    "threshold",
    [
        -0.1,
        1.5,
        "high",
        "0.5",
        True,
        None,
        float("nan"),
        float("inf"),
        10**400,
        -(10**400),
    ],
)
@pytest.mark.asyncio
async def test_flag_payload_invalid_threshold_gives_the_default(
    flag, config_log, threshold
):
    flag(
        {
            "mode": "enforce",
            "signup_threshold": threshold,
            "apikey_threshold": threshold,
            "policy": "A policy from the flag.",
        }
    )
    config = await fraud_config.read_fraud_check_config()
    assert config.mode == FraudCheckMode.ENFORCE
    assert config.signup_threshold == DEFAULT_SIGNUP_THRESHOLD
    assert config.apikey_threshold == DEFAULT_APIKEY_THRESHOLD
    assert config.policy == "A policy from the flag."
    (warning,) = config_log.warnings
    assert warning[1]["fields"] == ["signup_threshold", "apikey_threshold"]
    assert "A policy from the flag." not in repr(warning)


@pytest.mark.asyncio
async def test_flag_payload_threshold_bounds_are_valid(flag, config_log):
    flag({"signup_threshold": 0, "apikey_threshold": 1})
    config = await fraud_config.read_fraud_check_config()
    assert (config.signup_threshold, config.apikey_threshold) == (0.0, 1.0)
    assert config_log.warnings == []


@pytest.mark.asyncio
async def test_flag_payload_invalid_fields_log_once_without_the_policy(
    flag, config_log
):
    flag({"policy": "   ", "signup_threshold": 2})
    for _ in range(3):
        await fraud_config.read_fraud_check_config()
    (warning,) = config_log.warnings
    assert warning[1]["fields"] == ["policy", "signup_threshold"]

    # A different bad payload logs again, even with the same invalid field.
    flag({"policy": 7})
    await fraud_config.read_fraud_check_config()
    assert len(config_log.warnings) == 2
    flag({"policy": 8})
    await fraud_config.read_fraud_check_config()
    assert len(config_log.warnings) == 3
    # A valid payload resets the memory.
    flag({"policy": "fine"})
    await fraud_config.read_fraud_check_config()
    flag({"policy": 7})
    await fraud_config.read_fraud_check_config()
    assert len(config_log.warnings) == 4


@pytest.mark.asyncio
async def test_flag_payload_invalid_policy_in_an_off_payload_keeps_the_check_off(
    flag, config_log
):
    flag({"mode": "off", "policy": ""})
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.OFF


def test_config_repr_never_carries_the_policy():
    config = FraudCheckConfig(policy="A policy that must stay out of logs.")
    assert "must stay out of logs" not in repr(config)
    assert "must stay out of logs" not in str(config)


@pytest.mark.asyncio
async def test_flag_read_returning_none_keeps_the_last_known_payload(flag, monkeypatch):
    """The PostHog client returns None both for a missing flag and for a failed
    request. After one good read, a None keeps that payload instead of the defaults."""
    store = {}

    async def _get_cache(*, namespace, key, retry=True, **kwargs):
        return store.get(json.dumps(key, sort_keys=True))

    async def _set_cache(*, namespace, key, value, **kwargs):
        store[json.dumps(key, sort_keys=True)] = value

    monkeypatch.setattr(fraud_config, "get_cache", _get_cache)
    monkeypatch.setattr(fraud_config, "set_cache", _set_cache)

    # Never seen: defaults, and the empty payload is cached.
    flag(None)
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.ENFORCE

    store.clear()
    flag({"mode": "off"})
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.OFF

    # The short cache expires, then PostHog fails and the client returns None.
    store.pop(json.dumps({"ff": "fraud-check"}, sort_keys=True))
    flag(None)
    assert (await fraud_config.read_fraud_check_config()).mode == FraudCheckMode.OFF


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
    [
        httpx.ReadTimeout("slow"),
        httpx.ConnectError("down"),
        500,
        401,
        "not a number",
        "0.95",
        True,
        2,
        1.5,
        -0.1,
        float("inf"),
        float("nan"),
    ],
)
async def test_ask_noul_returns_none_on_any_failure_or_invalid_score(jev, answer):
    jev.answer = answer
    assert await fraud_jev.ask_noul(state="x", question="q") is None


@pytest.mark.asyncio
async def test_ask_noul_accepts_the_probability_bounds(jev):
    for answer in (0, 1, 0.0, 1.0):
        jev.answer = answer
        assert await fraud_jev.ask_noul(state="x", question="q") == float(answer)


@pytest.mark.asyncio
async def test_ask_noul_refuses_a_plain_http_url(jev, monkeypatch):
    monkeypatch.setattr(env.typesafe, "api_url", "http://jev.test")
    assert await fraud_jev.ask_noul(state="x", question="q") is None
    assert jev.requests == []


@pytest.mark.asyncio
async def test_ask_noul_failure_log_carries_no_response_text(jev, monkeypatch):
    seen = []
    monkeypatch.setattr(
        fraud_jev.log, "warning", lambda *args, **kwargs: seen.append((args, kwargs))
    )
    jev.answer = "victim@example.com"
    assert await fraud_jev.ask_noul(state="x", question="q") is None
    assert "victim@example.com" not in repr(seen)


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
    jev.answer = DEFAULT_SIGNUP_THRESHOLD
    verdict = await service.check_signup(
        organization_id=ORGANIZATION_ID, email="qzxvbn@mail-drop.example"
    )
    assert verdict.flagged is True
    assert verdict.action == "skip_grants"
    assert verdict.domain == "mail-drop.example"
    assert verdict.threshold == DEFAULT_SIGNUP_THRESHOLD
    assert service.fraud_dao.marks == [
        (ORGANIZATION_ID, FraudCheckpoint.SIGNUP, DEFAULT_SIGNUP_THRESHOLD)
    ]
    (request,) = jev.requests
    assert request["state"] == {
        "policy": DEFAULT_POLICY,
        "signup": {"email": "qzxvbn@mail-drop.example"},
    }
    assert request["questions"]["fraud"]["instructions"].endswith(
        "Judge from the email address alone."
    )


@pytest.mark.asyncio
async def test_signup_below_threshold_allows(service, flag, jev):
    jev.answer = DEFAULT_SIGNUP_THRESHOLD - 0.01
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
async def test_signup_sends_the_policy_from_the_flag(service, flag, jev):
    flag({"policy": "A policy from the flag."})
    await service.check_signup(
        organization_id=ORGANIZATION_ID, email="jane@company.example"
    )
    (request,) = jev.requests
    assert request["state"]["policy"] == "A policy from the flag."


@pytest.mark.asyncio
async def test_signup_sends_the_default_policy_when_the_flag_policy_is_malformed(
    service, flag, jev
):
    flag({"policy": ""})
    await service.check_signup(
        organization_id=ORGANIZATION_ID, email="jane@company.example"
    )
    (request,) = jev.requests
    assert request["state"]["policy"] == DEFAULT_POLICY


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

    flagged = [True]

    async def _fraud(*, organization_id, email):
        calls.append(("fraud", organization_id, email))
        return bool(flagged)

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

    m = organizations_service_module
    monkeypatch.setattr(m, "_free_credits_check", _allowed)
    monkeypatch.setattr(m, "signup_is_fraud", _fraud)
    monkeypatch.setattr(m, "_provision_wallet_general_balance", _provision)
    monkeypatch.setattr(m, "_award_signup_grant", _award)
    monkeypatch.setattr(m, "_subscription_service", _FakeSubscriptionService())
    monkeypatch.setattr(m, "check_entitlements", _no_entitlements)

    organization = SimpleNamespace(id=ORGANIZATION_ID, name="acme")
    await m.provision_signup_subscription(
        organization, organization_email="qzxvbn@mail-drop.example"
    )

    # No signup grant; the balance row is still created.
    assert calls == [
        ("fraud", ORGANIZATION_ID, "qzxvbn@mail-drop.example"),
        ("provision", None),
    ]

    calls.clear()
    flagged.clear()
    await m.provision_signup_subscription(
        organization, organization_email="ada@work.example"
    )
    assert calls == [
        ("fraud", ORGANIZATION_ID, "ada@work.example"),
        ("provision", None),
        ("award", ORGANIZATION_ID),
    ]


@pytest.mark.asyncio
async def test_organization_update_cannot_set_or_clear_fraud_flags(monkeypatch):
    from oss.src.models.api.organization_models import OrganizationUpdate

    organization = SimpleNamespace(
        id=ORGANIZATION_ID,
        slug=None,
        flags={
            "fraud_no_grants": True,
            "fraud_check": {"checkpoint": "signup", "score": 0.9},
            "allow_email": True,
        },
    )

    class _Result:
        def scalars(self):
            return self

        def first(self):
            return organization

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, statement):
            return _Result()

        async def commit(self):
            return None

        async def refresh(self, instance):
            return None

    m = organizations_service_module
    monkeypatch.setattr(
        m, "get_transactions_engine", lambda: SimpleNamespace(session=_Session)
    )
    await m.update_organization(
        str(ORGANIZATION_ID),
        OrganizationUpdate(
            flags={
                "fraud_no_grants": False,
                "fraud_check": None,
                "allow_email": True,
            }
        ),
    )
    assert organization.flags["fraud_no_grants"] is True
    assert organization.flags["fraud_check"] == {"checkpoint": "signup", "score": 0.9}


# ---------------------------------------------------------------------------
# API key check point
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_key_at_threshold_holds_wallet_and_marks_organization(
    service, flag, jev
):
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)

    jev.answer = DEFAULT_APIKEY_THRESHOLD
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is True
    assert verdict.action == "hold_wallet"
    assert verdict.threshold == DEFAULT_APIKEY_THRESHOLD
    assert service.fraud_dao.marks == [
        (ORGANIZATION_ID, FraudCheckpoint.API_KEY, DEFAULT_APIKEY_THRESHOLD)
    ]

    # The floor is left alone; the wallet is empty because its credits expired.
    balance = await service.wallets_service.wallets_dao.get_general_balance(
        organization_id=ORGANIZATION_ID
    )
    assert balance.floor_musd == 0
    assert not await service.wallets_service.check(organization_id=ORGANIZATION_ID)

    (request,) = jev.requests
    assert request["state"]["policy"] == DEFAULT_POLICY
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
async def test_api_key_sends_the_policy_from_the_flag(service, flag, jev):
    flag({"policy": "A policy from the flag.", "apikey_threshold": 0.5})
    jev.answer = 0.5
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is True
    assert verdict.threshold == 0.5
    (request,) = jev.requests
    assert request["state"]["policy"] == "A policy from the flag."


@pytest.mark.asyncio
async def test_api_key_below_threshold_leaves_wallet_alone(service, flag, jev):
    jev.answer = DEFAULT_APIKEY_THRESHOLD - 0.01
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
async def test_api_key_already_marked_organization_is_held_without_rescoring(
    service, flag, jev
):
    """A marker without a finished hold (a failed or timed out hold) is completed by the
    next key, and nothing is sent to Jev again."""
    service.fraud_dao.blocked.add(ORGANIZATION_ID)
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)
    assert (
        await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
        is None
    )
    assert jev.requests == []
    assert not await service.wallets_service.check(organization_id=ORGANIZATION_ID)


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


@pytest.mark.asyncio
async def test_api_key_by_an_invited_member_is_never_scored(service, flag, jev):
    service.fraud_dao.signals = _signals().model_copy(
        update={"owns_organization": False}
    )
    jev.answer = 1.0
    assert (
        await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
        is None
    )
    assert jev.requests == []
    assert service.fraud_dao.marks == []
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "billing",
    [
        BillingFacts(plan="cloud_v0_pro"),
        BillingFacts(plan="cloud_v0_business"),
        BillingFacts(plan="self_hosted_enterprise"),
        BillingFacts(plan=None),
        BillingFacts(plan="cloud_v0_hobby", has_stripe_ids=True),
        BillingFacts(plan="cloud_v0_hobby", has_paid_credit=True),
    ],
    ids=["pro", "business", "self_hosted", "no_subscription", "stripe", "paid_credit"],
)
async def test_api_key_in_a_paying_or_unknown_organization_is_never_scored(
    service, flag, jev, billing
):
    service.fraud_dao.billing = billing
    jev.answer = 1.0
    assert (
        await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
        is None
    )
    assert jev.requests == []
    assert service.fraud_dao.marks == []
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)


@pytest.mark.asyncio
async def test_api_key_check_is_bounded_and_fails_open_when_a_read_stalls(
    flag, jev, monkeypatch
):
    import asyncio

    class _Stalled(FakeFraudDAO):
        async def read_api_key_signals(self, **kwargs):
            await asyncio.sleep(60)

    monkeypatch.setattr(fraud_service_module, "DECISION_TIMEOUT_SECONDS", 0.05)
    svc = FraudService(fraud_dao=_Stalled(), wallets_service=_wallets_service())
    monkeypatch.setattr(fraud_service_module, "_fraud_service", svc)
    await asyncio.wait_for(
        fraud_service_module.check_api_key_creation(
            user_id=str(uuid4()), project_id=str(uuid4())
        ),
        timeout=1,
    )
    assert svc.fraud_dao.marks == []


@pytest.mark.asyncio
async def test_signup_check_is_bounded_and_fails_open_when_posthog_stalls(
    jev, monkeypatch
):
    import asyncio

    async def _stalled():
        await asyncio.sleep(60)

    monkeypatch.setattr(fraud_service_module, "DECISION_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(fraud_service_module, "read_fraud_check_config", _stalled)
    dao = FakeFraudDAO()
    svc = FraudService(fraud_dao=dao, wallets_service=_wallets_service())
    monkeypatch.setattr(fraud_service_module, "_fraud_service", svc)
    flagged = await asyncio.wait_for(
        fraud_service_module.signup_is_fraud(
            organization_id=ORGANIZATION_ID, email="a@b.example"
        ),
        timeout=1,
    )
    assert flagged is False
    assert dao.marks == []


@pytest.mark.asyncio
async def test_api_key_hold_failure_after_the_marker_still_allows(
    flag, jev, monkeypatch
):
    class _BrokenWallets(WalletsService):
        async def hold(self, **kwargs):
            raise RuntimeError("db down")

    dao = FakeFraudDAO(signals=_signals())
    svc = FraudService(
        fraud_dao=dao,
        wallets_service=_BrokenWallets(wallets_dao=FakeWalletsDAO()),
    )
    monkeypatch.setattr(fraud_service_module, "_fraud_service", svc)
    jev.answer = 0.99
    await fraud_service_module.check_api_key_creation(
        user_id=str(uuid4()), project_id=str(uuid4())
    )
    # The marker is written first, so a failed hold leaves only the grant block.
    assert dao.marks == [(ORGANIZATION_ID, FraudCheckpoint.API_KEY, 0.99)]


@pytest.mark.asyncio
async def test_api_key_payment_during_the_jev_call_prevents_the_hold(
    service, flag, jev
):
    real_handler = jev.handler

    def _pay_then_answer(request):
        service.fraud_dao.billing = BillingFacts(
            plan="cloud_v0_pro", has_stripe_ids=True
        )
        return real_handler(request)

    jev.handler = _pay_then_answer
    jev.answer = 0.99
    verdict = await service.check_api_key_creation(user_id=uuid4(), project_id=uuid4())
    assert verdict.flagged is True
    assert service.fraud_dao.marks == []
    assert await service.wallets_service.check(organization_id=ORGANIZATION_ID)


@pytest.mark.asyncio
async def test_api_key_hold_never_expires_paid_credits(flag, jev):
    now = datetime.now(timezone.utc)
    free = _credit(
        credit_kind="signup_grant",
        balance_musd=500_000,
        end_time=now + timedelta(days=300),
    )
    purchase = _credit(
        credit_kind="purchase",
        balance_musd=1_000_000,
        end_time=now + timedelta(days=300),
    )
    svc = FraudService(
        fraud_dao=FakeFraudDAO(signals=_signals()),
        wallets_service=_wallets_service(free, purchase),
    )
    jev.answer = 0.99
    await svc.check_api_key_creation(user_id=uuid4(), project_id=uuid4())

    credits = svc.wallets_service.wallets_dao._credits
    assert credits[free[0].wallet_credit_id][0].end_time <= datetime.now(timezone.utc)
    assert credits[purchase[0].wallet_credit_id][0].end_time == purchase[0].end_time
    assert await svc.wallets_service.check(organization_id=ORGANIZATION_ID)


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
async def test_marker_blocks_daily_grants_only_while_free_and_unpaid():
    dao = FakeFraudDAO()
    svc = FraudService(fraud_dao=dao, wallets_service=_wallets_service())
    assert await svc.grants_blocked(organization_id=ORGANIZATION_ID) is False

    dao.blocked.add(ORGANIZATION_ID)
    assert await svc.grants_blocked(organization_id=ORGANIZATION_ID) is True

    # After an upgrade or a top-up, the marker no longer blocks anything.
    dao.billing = BillingFacts(plan="cloud_v0_pro")
    assert await svc.grants_blocked(organization_id=ORGANIZATION_ID) is False
    dao.billing = BillingFacts(plan="cloud_v0_hobby", has_paid_credit=True)
    assert await svc.grants_blocked(organization_id=ORGANIZATION_ID) is False


@pytest.mark.asyncio
async def test_hold_expires_live_credits_and_keeps_expired_ones():
    now = datetime.now(timezone.utc)
    live = _credit(
        credit_kind="signup_grant", balance_musd=50, end_time=now + timedelta(days=10)
    )
    already_expired = _credit(
        credit_kind="signup_grant", balance_musd=50, end_time=now - timedelta(days=1)
    )
    svc = _wallets_service(live, already_expired)
    dao = svc.wallets_dao

    expired = await svc.hold(organization_id=ORGANIZATION_ID, now=now)
    assert expired == 1
    assert dao._credits[live[0].wallet_credit_id][0].end_time == now
    assert dao.general_balance.floor_musd == 0

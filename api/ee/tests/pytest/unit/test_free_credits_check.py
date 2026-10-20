"""Unit tests for the signup free-credits check
(``ee.src.core.organizations.service._free_credits_check``) and the mint policy's
refusal names (``ee.src.core.starter_credits_bridge.service._mint_policy_refusal``)."""

import pytest

from oss.src.utils.env import env, StarterCreditsBridgeConfig

from ee.src.core.organizations import service as organizations_service
from ee.src.core.starter_credits_bridge import service as mint_policy
from ee.src.core.starter_credits_bridge.types import MintPolicy


def _policy(**overrides) -> MintPolicy:
    values = dict(
        global_daily=40,
        global_hourly=30,
        work_domain_daily=10,
        freemail_domains=["freemail.test"],
        disposable_domains=["throwaway.test"],
        block_digit_locals=True,
        grant_usd=10.0,
        key_max_parallel_requests=2,
        key_rpm_limit=30,
        key_tpm_limit=200_000,
    )
    values.update(overrides)
    return MintPolicy(**values)


class FakeCacheEngine:
    def __init__(self, error=None):
        self.counts = {}
        self.error = error

    async def incr(self, key):
        if self.error is not None:
            raise self.error
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, ttl):
        pass


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setattr(
        env,
        "starter_credits_bridge",
        StarterCreditsBridgeConfig(
            enabled=True,
            proxy_public_url="https://credits-proxy.example.test",
            proxy_admin_url="http://litellm-proxy:4000",
            master_key="sk-master-test",
            team_id="team-starter",
            model_id="vertex_ai/some-model",
        ),
    )
    fake = FakeCacheEngine()
    monkeypatch.setattr(mint_policy, "get_cache_engine", lambda: fake)
    return fake


class TestMintPolicyRefusal:
    async def test_an_allowed_signup_has_no_refusal(self, engine):
        assert (
            await mint_policy._mint_policy_refusal("alice@acme.test", _policy()) is None
        )

    async def test_the_eleventh_signup_of_a_work_domain_is_refused_by_the_domain_cap(
        self, engine
    ):
        policy = _policy()
        for index in range(10):
            assert (
                await mint_policy._mint_policy_refusal(
                    f"user{chr(97 + index)}@acme.test",
                    policy,
                    counter_prefix=mint_policy.SIGNUP_GRANT_COUNTER_PREFIX,
                )
                is None
            )

        assert (
            await mint_policy._mint_policy_refusal(
                "eleventh@acme.test",
                policy,
                counter_prefix=mint_policy.SIGNUP_GRANT_COUNTER_PREFIX,
            )
            == "work_domain_daily"
        )

    async def test_the_global_daily_cap_is_named(self, engine):
        policy = _policy(global_daily=1)

        assert await mint_policy._mint_policy_refusal("a@freemail.test", policy) is None
        assert (
            await mint_policy._mint_policy_refusal("b@freemail.test", policy)
            == "global_daily"
        )

    async def test_the_global_hourly_cap_is_named(self, engine):
        policy = _policy(global_hourly=1)

        assert await mint_policy._mint_policy_refusal("a@freemail.test", policy) is None
        assert (
            await mint_policy._mint_policy_refusal("b@freemail.test", policy)
            == "global_hourly"
        )

    @pytest.mark.parametrize(
        ("address", "rule"),
        [
            ("abc@throwaway.test", "disposable_domain"),
            ("person+trial@freemail.test", "plus_local_part"),
            ("john99@acme.test", "digit_local_part"),
        ],
    )
    async def test_an_email_rule_is_named_before_any_counter(
        self, engine, address, rule
    ):
        assert await mint_policy._mint_policy_refusal(address, _policy()) == rule
        assert engine.counts == {}

    async def test_a_redis_error_is_named(self, engine):
        engine.error = ConnectionError("redis down")

        assert (
            await mint_policy._mint_policy_refusal("a@freemail.test", _policy())
            == "velocity_counters_unavailable"
        )


def _with_refusal(monkeypatch, refusal, *, policy=object()):
    async def _resolve():
        return policy

    async def _refusal(organization_email, policy, counter_prefix):
        assert counter_prefix == mint_policy.SIGNUP_GRANT_COUNTER_PREFIX
        return refusal

    monkeypatch.setattr(mint_policy, "_resolve_mint_policy", _resolve)
    monkeypatch.setattr(mint_policy, "_mint_policy_refusal", _refusal)


class TestFreeCreditsCheck:
    async def test_a_work_domain_cap_refusal_raises_the_floor(self, monkeypatch):
        _with_refusal(monkeypatch, "work_domain_daily")

        assert await organizations_service._free_credits_check("a@acme.test") == (
            False,
            True,
        )

    @pytest.mark.parametrize(
        "refusal", ["global_daily", "global_hourly", "velocity_counters_unavailable"]
    )
    async def test_a_global_cap_refusal_skips_only_the_grant(
        self, monkeypatch, refusal
    ):
        _with_refusal(monkeypatch, refusal)

        assert await organizations_service._free_credits_check("a@acme.test") == (
            False,
            False,
        )

    @pytest.mark.parametrize(
        "refusal", ["disposable_domain", "plus_local_part", "digit_local_part"]
    )
    async def test_an_email_rule_refusal_raises_the_floor(self, monkeypatch, refusal):
        _with_refusal(monkeypatch, refusal)

        assert await organizations_service._free_credits_check("a@acme.test") == (
            False,
            True,
        )

    async def test_an_allowed_signup_gets_the_grant_and_no_floor(self, monkeypatch):
        _with_refusal(monkeypatch, None)

        assert await organizations_service._free_credits_check("a@acme.test") == (
            True,
            False,
        )

    async def test_a_missing_policy_skips_only_the_grant(self, monkeypatch):
        _with_refusal(monkeypatch, "work_domain_daily", policy=None)

        assert await organizations_service._free_credits_check("a@acme.test") == (
            False,
            False,
        )

    async def test_an_error_skips_only_the_grant(self, monkeypatch):
        _with_refusal(monkeypatch, None)

        async def _broken(*args, **kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr(mint_policy, "_mint_policy_refusal", _broken)

        assert await organizations_service._free_credits_check("a@acme.test") == (
            False,
            False,
        )

    async def test_a_real_disposable_domain_raises_the_floor(self, monkeypatch, engine):
        async def _resolve():
            return _policy()

        monkeypatch.setattr(mint_policy, "_resolve_mint_policy", _resolve)

        assert await organizations_service._free_credits_check(
            "abc@throwaway.test"
        ) == (False, True)

"""Unit tests for the signup grant policy (``ee.src.core.wallets.signup_policy``): how
the PostHog payload resolves, the email rules, the velocity caps, the free-mail defaults,
and what a refusal logs."""

from types import SimpleNamespace

import pytest

from oss.src.utils.env import env, PostHogConfig

from ee.src.core.wallets import signup_policy
from ee.src.core.wallets.signup_policy import MintPolicy


# Synthetic policy values for tests only; the real values ship via the PostHog
# payload and are deliberately absent from source.
def _policy(**overrides) -> MintPolicy:
    values = dict(
        global_daily=4,
        global_hourly=3,
        work_domain_daily=1,
        freemail_domains=["freemail.test"],
        block_digit_locals=True,
        grant_usd=10.0,
        key_max_parallel_requests=2,
        key_rpm_limit=30,
        key_tpm_limit=200_000,
    )
    values.update(overrides)
    return MintPolicy(**values)


async def _allows(organization_email: str, policy: MintPolicy) -> bool:
    return await signup_policy.mint_policy_refusal(organization_email, policy) is None


class TestMintPolicyResolution:
    _PAYLOAD = {
        "global_daily": 4,
        "global_hourly": 3,
        "work_domain_daily": 1,
        "freemail_domains": ["freemail.test"],
        "block_digit_locals": True,
        "grant_usd": 10.0,
        "key_max_parallel_requests": 2,
        "key_rpm_limit": 30,
        "key_tpm_limit": 200_000,
    }

    @pytest.fixture(autouse=True)
    def _stubs(self, monkeypatch):
        # These cases are about a deployment that runs its own PostHog; the
        # development-policy cases below say so explicitly.
        monkeypatch.setattr(env, "posthog", PostHogConfig(api_key_configured=True))
        self.cache: dict = {}
        self.alerts = []

        async def fake_get_cache(*, namespace, key, retry=False, **kwargs):
            return self.cache.get((namespace, tuple(sorted(key.items()))))

        async def fake_set_cache(*, namespace, key, value, **kwargs):
            self.cache[(namespace, tuple(sorted(key.items())))] = value

        monkeypatch.setattr(signup_policy, "get_cache", fake_get_cache)
        monkeypatch.setattr(signup_policy, "set_cache", fake_set_cache)
        monkeypatch.setattr(
            signup_policy,
            "_send_alert_background",
            lambda text: self.alerts.append(text),
        )
        self.monkeypatch = monkeypatch

    def _posthog_with(self, payload):
        return SimpleNamespace(
            get_feature_flag_payload=lambda flag, distinct_id: payload
        )

    def _broken_posthog(self):
        def boom(flag, distinct_id):
            raise RuntimeError("posthog down")

        return SimpleNamespace(get_feature_flag_payload=boom)

    async def test_payload_resolves_and_caches(self):
        self.monkeypatch.setattr(
            signup_policy,
            "_load_posthog",
            lambda: self._posthog_with(dict(self._PAYLOAD)),
        )

        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.global_daily == 4
        assert policy.grant_usd == 10.0
        assert policy.key_rpm_limit == 30
        assert len(self.cache) == 1

    async def test_a_policy_cached_before_the_upgrade_covers_an_outage(self):
        # Earlier releases cached the payload under this namespace. Reading the same one
        # keeps a PostHog outage during a rollout from turning off the signup grant.
        flag = env.signup_grant_policy.policy_flag
        self.cache[("starter_credits_bridge:policy", (("ff", flag),))] = dict(
            self._PAYLOAD
        )
        self.monkeypatch.setattr(signup_policy, "_load_posthog", self._broken_posthog)

        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.global_daily == 4

    async def test_json_string_payload_parses(self):
        import json

        self.monkeypatch.setattr(
            signup_policy,
            "_load_posthog",
            lambda: self._posthog_with(json.dumps(self._PAYLOAD)),
        )

        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.global_hourly == 3

    async def test_the_payload_is_the_only_source_of_policy_values(self):
        # No deployment can raise a cap or a grant on its own: the payload is it.
        payload = dict(self._PAYLOAD, grant_usd=7.5)
        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with(payload)
        )

        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.grant_usd == 7.5
        # The payload's list adds to the built-in defaults rather than replacing them.
        assert policy.is_freemail("freemail.test") is True
        assert policy.is_freemail("gmail.com") is True

    def _unconfigured_posthog(self):
        """A deployment that supplied no PostHog key of its own.

        Driven through the config the policy actually reads, not by stubbing the
        loader: `PostHogConfig` falls back to a built-in project key, so a stubbed
        loader would hide the very case this branch exists for.
        """
        self.monkeypatch.setattr(
            env, "posthog", PostHogConfig(api_key_configured=False)
        )

        def _must_not_be_consulted():
            raise AssertionError(
                "PostHog must not be consulted when the deployment configured none"
            )

        self.monkeypatch.setattr(signup_policy, "_load_posthog", _must_not_be_consulted)

    def test_enabled_cannot_tell_a_stock_checkout_from_a_configured_one(self):
        # The trap that made an earlier version of this fallback unreachable: the
        # PostHog config falls back to a built-in project key, so `enabled` is true
        # even where no operator ever configured PostHog.
        unconfigured = PostHogConfig(api_key_configured=False)

        assert unconfigured.enabled is True
        assert unconfigured.api_key_configured is False

    async def test_unconfigured_posthog_uses_the_development_policy(self):
        # Local dev and QA stacks cannot publish a payload, so they run on the
        # built-in one instead of being blocked by the fail-closed rule.
        self._unconfigured_posthog()
        self.monkeypatch.setattr(signup_policy, "_development_policy_announced", False)

        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.grant_usd == 5.0
        assert policy.global_daily == 1000
        assert policy.key_tpm_limit == 1_000_000
        assert policy.block_digit_locals is False
        # The built-in domain list still applies through the union.
        assert policy.is_freemail("gmail.com") is True
        # Nothing was cached: the development policy never becomes a stored payload.
        assert self.cache == {}

    async def test_the_development_policy_announces_itself_once(self, caplog):
        self._unconfigured_posthog()
        self.monkeypatch.setattr(signup_policy, "_development_policy_announced", False)

        with caplog.at_level("WARNING"):
            await signup_policy.resolve_mint_policy()
            await signup_policy.resolve_mint_policy()

        notices = [
            record
            for record in caplog.records
            if "built-in development policy" in record.getMessage()
        ]
        assert len(notices) == 1

    async def test_configured_posthog_without_a_payload_still_fails_closed(self):
        # The fallback is only for a deployment that configured no PostHog. Here one
        # is configured, and a missing payload is a real "no policy" signal.
        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with(None)
        )

        assert await signup_policy.resolve_mint_policy() is None

    async def test_a_configured_posthog_that_will_not_load_still_fails_closed(self):
        # Configured, but the client cannot be built: on such a deployment that is a
        # fault to fail closed on, never a reason to grant credits on dev values.
        self.monkeypatch.setattr(signup_policy, "_load_posthog", lambda: None)

        assert await signup_policy.resolve_mint_policy() is None

    async def test_incomplete_payload_fails_closed(self):
        partial = dict(self._PAYLOAD)
        del partial["grant_usd"]
        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with(partial)
        )

        assert await signup_policy.resolve_mint_policy() is None

    async def test_unknown_payload_field_fails_closed(self):
        payload = dict(self._PAYLOAD)
        payload["surprise"] = 1
        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with(payload)
        )

        assert await signup_policy.resolve_mint_policy() is None

    async def test_non_finite_grant_fails_closed(self):
        payload = dict(self._PAYLOAD)
        payload["grant_usd"] = float("inf")
        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with(payload)
        )

        assert await signup_policy.resolve_mint_policy() is None

    async def test_outage_falls_back_to_cached_payload(self):
        self.monkeypatch.setattr(
            signup_policy,
            "_load_posthog",
            lambda: self._posthog_with(dict(self._PAYLOAD)),
        )
        assert await signup_policy.resolve_mint_policy() is not None

        self.monkeypatch.setattr(signup_policy, "_load_posthog", self._broken_posthog)
        policy = await signup_policy.resolve_mint_policy()

        assert policy is not None
        assert policy.global_daily == 4

    async def test_malformed_live_payload_fails_closed_despite_cache(self):
        # A cached valid payload may stand in for an OUTAGE only, never for a
        # malformed live response (a bad rollout must fail closed, loudly).
        self.monkeypatch.setattr(
            signup_policy,
            "_load_posthog",
            lambda: self._posthog_with(dict(self._PAYLOAD)),
        )
        assert await signup_policy.resolve_mint_policy() is not None

        self.monkeypatch.setattr(
            signup_policy, "_load_posthog", lambda: self._posthog_with("{not json")
        )

        assert await signup_policy.resolve_mint_policy() is None
        assert len(self.alerts) == 1


class FakeCacheEngine:
    def __init__(self, counts=None, error=None):
        self.counts = counts or {}
        self.error = error
        self.expired = []

    async def incr(self, key):
        if self.error is not None:
            raise self.error
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def decr(self, key):
        self.counts[key] = self.counts.get(key, 0) - 1
        return self.counts[key]

    async def expire(self, key, ttl):
        self.expired.append((key, ttl))


class TestMintPolicyAllows:
    @pytest.fixture(autouse=True)
    def _stubs(self, monkeypatch):
        self.engine = FakeCacheEngine()
        monkeypatch.setattr(signup_policy, "get_cache_engine", lambda: self.engine)
        self.monkeypatch = monkeypatch

    async def test_freemail_skips_domain_counter_and_digit_rule(self):
        assert await _allows("john99@freemail.test", _policy()) is True
        assert len(self.engine.counts) == 2
        assert not any("domain" in key for key in self.engine.counts)

    async def test_work_domain_digit_local_refused_before_counters(self):
        assert await _allows("john99@acme.test", _policy()) is False
        assert self.engine.counts == {}

    async def test_work_domain_daily_cap_blocks(self):
        assert await _allows("alice@acme.test", _policy()) is True
        assert await _allows("bob@acme.test", _policy()) is False

    async def test_digit_rule_can_be_disabled_by_policy(self):
        policy = _policy(block_digit_locals=False)

        assert await _allows("john99@acme.test", policy) is True

    @pytest.mark.parametrize(
        "address",
        ["person+trial@freemail.test", "person+trial@acme.test"],
    )
    async def test_plus_local_part_refuses_before_any_counter(self, address):
        assert await _allows(address, _policy()) is False
        assert self.engine.counts == {}

    async def test_plus_local_part_allows_an_address_without_a_plus(self):
        assert await _allows("person@freemail.test", _policy()) is True

    @pytest.mark.parametrize(
        "address",
        ["person+trial@agenta.ai", "person+1@Agenta.AI"],
    )
    async def test_plus_local_part_allows_the_agenta_domain(self, address):
        policy = _policy(work_domain_daily=10)

        assert await _allows(address, policy) is True

    @pytest.mark.parametrize(
        "address", ["abcxyz@throwaway.test", "abcxyz@mx.throwaway.test"]
    )
    async def test_a_disposable_domain_is_refused_before_any_counter(self, address):
        policy = _policy(disposable_domains=[" Throwaway.TEST "])

        assert await _allows(address, policy) is False
        assert signup_policy.email_rules_allow(address, policy) is False
        assert self.engine.counts == {}

    async def test_a_domain_that_only_ends_like_a_disposable_one_passes(self):
        policy = _policy(disposable_domains=["throwaway.test"])

        assert signup_policy.email_rules_allow("abc@notthrowaway.test", policy) is True

    async def test_global_hourly_cap_blocks(self):
        policy = _policy(global_hourly=2)

        assert await _allows("a@freemail.test", policy) is True
        assert await _allows("b@freemail.test", policy) is True
        assert await _allows("c@freemail.test", policy) is False

    async def test_global_daily_cap_blocks(self):
        policy = _policy(global_daily=1, global_hourly=10)

        assert await _allows("a@freemail.test", policy) is True
        assert await _allows("b@freemail.test", policy) is False

    async def test_redis_error_fails_closed(self):
        self.engine.error = ConnectionError("redis down")

        assert await _allows("a@freemail.test", _policy()) is False


class TestFreemailDefaults:
    """Consumer mail providers are recognized without an operator listing them.

    A domain the policy does not classify as free mail is treated as a company domain:
    every signup from it shares one per-domain daily cap, and a digit in the local part
    refuses the mint. Applying that to proton.me or icloud.com refuses ordinary personal
    signups, so the defaults ship in code and a configured list only adds to them.
    """

    @pytest.mark.parametrize(
        "domain",
        ["proton.me", "icloud.com", "outlook.de", "gmx.net", "yandex.ru", "qq.com"],
    )
    def test_a_payload_without_a_list_still_classifies_consumer_mail(self, domain):
        policy = MintPolicy(
            global_daily=4,
            global_hourly=3,
            work_domain_daily=1,
            block_digit_locals=True,
            grant_usd=10.0,
            key_max_parallel_requests=2,
            key_rpm_limit=30,
            key_tpm_limit=200_000,
        )

        assert policy.is_freemail(domain) is True

    def test_a_configured_list_is_added_to_the_defaults_not_swapped_for_them(self):
        policy = _policy(freemail_domains=["freemail.test"])

        assert policy.is_freemail("freemail.test") is True
        assert policy.is_freemail("gmail.com") is True
        assert policy.is_freemail("acme.test") is False

    def test_classification_ignores_case_and_padding(self):
        policy = _policy(freemail_domains=["  Other.TEST  "])

        assert policy.is_freemail("PROTON.ME") is True
        assert policy.is_freemail("other.test") is True


class TestRefusalLogging:
    """A refusal names the rule and the DOMAIN. Never the address: the domain is what
    makes a refusal diagnosable, and the local part identifies the person."""

    @pytest.fixture(autouse=True)
    def _stubs(self, monkeypatch):
        self.engine = FakeCacheEngine()
        monkeypatch.setattr(signup_policy, "get_cache_engine", lambda: self.engine)
        self.records: list = []

        class _RecordingLog:
            def __init__(self, records):
                self._records = records

            def warning(self, message, **kwargs):
                self._records.append((message, kwargs))

            def __getattr__(self, _name):
                return lambda *args, **kwargs: None

        monkeypatch.setattr(signup_policy, "log", _RecordingLog(self.records))

    async def test_a_digit_local_refusal_names_the_rule_and_the_domain(self):
        assert await _allows("john99@acme.test", _policy()) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "digit_local_part"
        assert fields["domain"] == "acme.test"
        assert "john99" not in repr((message, fields))

    async def test_a_plus_local_refusal_names_only_the_rule_and_domain(self):
        assert (
            await _allows(
                "person+private@freemail.test",
                _policy(),
            )
            is False
        )

        message, fields = self.records[-1]
        assert fields == {"rule": "plus_local_part", "domain": "freemail.test"}
        assert "person" not in repr((message, fields))
        assert "private" not in repr((message, fields))

    async def test_a_velocity_refusal_names_the_rule_and_the_domain(self):
        policy = _policy(work_domain_daily=1)

        assert await _allows("alice@acme.test", policy) is True
        assert await _allows("bob@acme.test", policy) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "work_domain_daily"
        assert fields["domain"] == "acme.test"
        assert "bob" not in repr((message, fields))

    async def test_an_unverifiable_refusal_names_the_rule_and_the_domain(self):
        self.engine.error = ConnectionError("redis down")

        assert await _allows("carol@acme.test", _policy()) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "velocity_counters_unavailable"
        assert fields["domain"] == "acme.test"
        assert "carol" not in repr((message, fields))

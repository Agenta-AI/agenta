"""Unit tests for the starter-credits-bridge seeding service
(``ee.src.core.starter_credits_bridge.service``): gating, team-ceiling refusal,
the row-first grant-record protocol and its failure boundaries (the lifetime
grant never increases), exact key/row pairing, concurrency, policy resolution,
and velocity caps, with every external dependency stubbed."""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.utils.env import env, StarterCreditsBridgeConfig
from oss.src.core.secrets.enums import CustomProviderKind

from ee.src.core.starter_credits_bridge import service
from ee.src.core.starter_credits_bridge.types import (
    KeyAliasExistsError,
    MintedKey,
    MintPolicy,
    ProxyRequestError,
)


ORGANIZATION_ID = "9f0e0f39-0000-4000-8000-000000000001"
ORGANIZATION_EMAIL = "someone@example.com"


def _armed_config(**overrides) -> StarterCreditsBridgeConfig:
    values = dict(
        enabled=True,
        proxy_public_url="https://credits-proxy.example.test",
        master_key="sk-master-test",
        team_id="team-starter",
        model_id="vertex_ai/some-model",
    )
    values.update(overrides)
    return StarterCreditsBridgeConfig(**values)


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


class FakeVaultService:
    """Stores real validated DTOs and enforces the project+slug unique index."""

    def __init__(self):
        self.row = None
        self.created_count = 0
        self.updated_count = 0
        self.create_dto = None
        # One entry per update: the owner flag the caller passed. The real service
        # refuses a managed row without it, so a False here is a broken write path.
        self.update_allow_managed = []

    async def get_secret_by_slug(self, secret_slug, project_id=None, **kwargs):
        assert secret_slug == service.STARTER_CREDITS_SLUG
        return self.row

    async def create_secret(self, *, project_id, create_secret_dto):
        await asyncio.sleep(0)
        if self.row is not None:
            raise RuntimeError("duplicate slug (unique index)")
        self.create_dto = create_secret_dto
        self.row = SimpleNamespace(
            id=uuid4(),
            header=create_secret_dto.header,
            data=create_secret_dto.secret.data,
            managed_by=create_secret_dto.managed_by,
            write_only=bool(create_secret_dto.write_only),
        )
        self.created_count += 1
        return self.row

    async def update_secret(
        self,
        *,
        secret_id,
        update_secret_dto,
        project_id=None,
        allow_managed=False,
        **kwargs,
    ):
        assert self.row is not None and self.row.id == secret_id
        self.update_allow_managed.append(allow_managed)
        self.row.data = update_secret_dto.secret.data
        self.updated_count += 1
        return self.row


class FakeProxyClient:
    """Stands in for StarterCreditsProxyClient with a per-alias key registry
    (budget + spend + metadata), so convergence is exercised against realistic
    proxy state."""

    records: dict = {}
    generate_fail_times: int = 0
    instances: list = []

    def __init__(self, *, base_url, master_key):
        self.base_url = base_url
        self.master_key = master_key
        self.generate_calls = []
        self.delete_calls = []
        self.block_calls = []
        FakeProxyClient.instances.append(self)

    @classmethod
    def seed_record(
        cls, key_alias, *, max_budget=10.0, spend=0.0, metadata=None, key=None
    ):
        cls.records[key_alias] = {
            "key_alias": key_alias,
            "token": f"hash-{key_alias}",
            "key": key or f"sk-preexisting-{key_alias}",
            "max_budget": max_budget,
            "spend": spend,
            "metadata": metadata or {},
        }

    async def generate_key(
        self,
        *,
        key_alias,
        max_budget,
        models,
        metadata,
        team_id,
        max_parallel_requests=None,
        rpm_limit=None,
        tpm_limit=None,
    ):
        await asyncio.sleep(0)
        self.generate_calls.append(
            dict(
                key_alias=key_alias,
                max_budget=max_budget,
                models=models,
                metadata=metadata,
                team_id=team_id,
                max_parallel_requests=max_parallel_requests,
                rpm_limit=rpm_limit,
                tpm_limit=tpm_limit,
            )
        )
        if FakeProxyClient.generate_fail_times > 0:
            FakeProxyClient.generate_fail_times -= 1
            raise ProxyRequestError(status_code=500, detail="mint failed")
        if key_alias in FakeProxyClient.records:
            raise KeyAliasExistsError(status_code=400, detail="already exists: alias")
        value = f"sk-virtual-{uuid4().hex[:8]}"
        FakeProxyClient.records[key_alias] = {
            "key_alias": key_alias,
            "token": f"hash-{key_alias}",
            "key": value,
            "max_budget": max_budget,
            "spend": 0.0,
            "metadata": dict(metadata),
        }
        return MintedKey(key=value, key_alias=key_alias)

    async def delete_keys(self, *, key_aliases):
        self.delete_calls.append(list(key_aliases))
        for key_alias in key_aliases:
            FakeProxyClient.records.pop(key_alias, None)

    async def block_key(self, *, key):
        self.block_calls.append(key)

    async def list_keys(self, *, key_alias):
        record = FakeProxyClient.records.get(key_alias)
        if not record:
            return []
        entry = {k: v for k, v in record.items() if k != "key"}
        return [dict(entry)]


def _all_generate_calls():
    return [
        call
        for instance in FakeProxyClient.instances
        for call in instance.generate_calls
    ]


def _all_delete_calls():
    return [
        call for instance in FakeProxyClient.instances for call in instance.delete_calls
    ]


def _all_block_calls():
    return [
        call for instance in FakeProxyClient.instances for call in instance.block_calls
    ]


def _row_extras(vault):
    provider = vault.row.data.provider
    return provider.extras or {}


@pytest.fixture
def seeding_env(monkeypatch):
    """Arm the config and stub every dependency; returns the mutable stubs."""
    FakeProxyClient.records = {}
    FakeProxyClient.generate_fail_times = 0
    FakeProxyClient.instances = []
    service._verified_teams.clear()

    config = _armed_config()
    monkeypatch.setattr(env, "starter_credits_bridge", config)

    project = SimpleNamespace(id=uuid4())
    vault = FakeVaultService()
    invalidated = []
    alerts = []
    released = []
    policy = _policy()

    async def fake_get_default_project(organization_id):
        assert organization_id == ORGANIZATION_ID
        return project

    async def fake_flag_enabled(organization_id):
        return True

    async def fake_resolve_policy():
        return policy

    async def fake_team_verified(client, config):
        return True

    async def fake_policy_allows(organization_email, policy):
        return True

    async def fake_invalidate_cache(**kwargs):
        invalidated.append(kwargs)

    def fake_send_alert_background(text):
        alerts.append(text)

    async def fake_release(organization_email, policy):
        released.append(organization_email)

    monkeypatch.setattr(
        service.db_manager,
        "get_default_project_by_organization_id",
        fake_get_default_project,
    )
    monkeypatch.setattr(service, "_vault_service", lambda: vault)
    monkeypatch.setattr(service, "_feature_flag_enabled", fake_flag_enabled)
    monkeypatch.setattr(service, "_resolve_mint_policy", fake_resolve_policy)
    monkeypatch.setattr(service, "_team_ceiling_verified", fake_team_verified)
    monkeypatch.setattr(service, "_mint_policy_allows", fake_policy_allows)
    monkeypatch.setattr(service, "invalidate_cache", fake_invalidate_cache)
    monkeypatch.setattr(service, "_send_alert_background", fake_send_alert_background)
    monkeypatch.setattr(service, "_release_velocity_slots", fake_release)
    monkeypatch.setattr(service, "StarterCreditsProxyClient", FakeProxyClient)

    return SimpleNamespace(
        config=config,
        policy=policy,
        project=project,
        vault=vault,
        invalidated=invalidated,
        alerts=alerts,
        released=released,
        monkeypatch=monkeypatch,
    )


async def _seed():
    await service.seed_starter_credits_bridge(
        organization_id=ORGANIZATION_ID,
        organization_email=ORGANIZATION_EMAIL,
    )


async def _seed_safely():
    await service.seed_starter_credits_bridge_safely(
        organization_id=ORGANIZATION_ID,
        organization_email=ORGANIZATION_EMAIL,
    )


async def _reconcile():
    return await service.reconcile_starter_credits_bridge(
        organization_id=ORGANIZATION_ID
    )


class TestSeeding:
    async def test_happy_path_row_first_then_paired_mint(self, seeding_env):
        await _seed()

        row = seeding_env.vault.row
        assert row is not None
        (call,) = _all_generate_calls()
        assert call["key_alias"] == ORGANIZATION_ID
        assert call["max_budget"] == 10.0
        assert call["models"] == ["vertex_ai/some-model"]
        assert call["team_id"] == "team-starter"
        assert call["max_parallel_requests"] == 2
        assert call["rpm_limit"] == 30
        assert call["tpm_limit"] == 200_000
        # The pairing is recorded AT mint, never as a best-effort afterthought.
        assert call["metadata"] == {
            "organization_id": ORGANIZATION_ID,
            "origin": service.ORIGIN_MARKER,
            "secret_id": str(row.id),
        }

        # The row is finalized: real key, grant record cleared.
        assert row.data.kind == CustomProviderKind.CUSTOM
        assert row.data.provider.key.startswith("sk-virtual-")
        assert row.data.provider.key == FakeProxyClient.records[ORGANIZATION_ID]["key"]
        assert service._GRANT_RECORD_FIELD not in _row_extras(seeding_env.vault)
        assert row.header.name == service.STARTER_CREDITS_NAME
        assert len(seeding_env.invalidated) >= 2

    async def test_disarmed_config_is_a_noop(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "starter_credits_bridge", _armed_config(enabled=False)
        )

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.row is None

    async def test_missing_team_id_disarms(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "starter_credits_bridge", _armed_config(team_id=None)
        )

        await _seed()

        assert FakeProxyClient.instances == []

    async def test_flag_off_makes_no_calls(self, seeding_env):
        async def flag_off(organization_id):
            return False

        seeding_env.monkeypatch.setattr(service, "_feature_flag_enabled", flag_off)

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.row is None

    async def test_unresolved_policy_skips_seed(self, seeding_env):
        async def no_policy():
            return None

        seeding_env.monkeypatch.setattr(service, "_resolve_mint_policy", no_policy)

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.row is None

    async def test_unverified_team_refuses_to_seed(self, seeding_env):
        async def team_unverified(client, config):
            return False

        seeding_env.monkeypatch.setattr(
            service, "_team_ceiling_verified", team_unverified
        )

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.row is None

    async def test_existing_row_is_idempotent_no_second_mint(self, seeding_env):
        await _seed()
        assert len(_all_generate_calls()) == 1

        await _seed()

        assert len(_all_generate_calls()) == 1

    async def test_policy_refusal_skips_mint(self, seeding_env):
        async def refused(organization_email, policy):
            return False

        seeding_env.monkeypatch.setattr(service, "_mint_policy_allows", refused)

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.row is None

    async def test_missing_default_project_skips(self, seeding_env):
        async def no_project(organization_id):
            return None

        seeding_env.monkeypatch.setattr(
            service.db_manager,
            "get_default_project_by_organization_id",
            no_project,
        )

        await _seed()

        assert _all_generate_calls() == []

    async def test_foreign_alias_key_refused_untouched_and_slot_released(
        self, seeding_env
    ):
        FakeProxyClient.seed_record(
            ORGANIZATION_ID, metadata={"origin": "someone-else"}
        )

        await _seed()

        assert _all_generate_calls() == []
        assert _all_delete_calls() == []
        assert ORGANIZATION_ID in FakeProxyClient.records
        assert seeding_env.released == [ORGANIZATION_EMAIL]

    async def test_failed_mint_releases_velocity_slot(self, seeding_env):
        FakeProxyClient.generate_fail_times = 1

        await _seed_safely()

        assert seeding_env.released == [ORGANIZATION_EMAIL]
        assert len(seeding_env.alerts) == 1


def _ours_metadata(secret_id=None):
    metadata = {
        "organization_id": ORGANIZATION_ID,
        "origin": service.ORIGIN_MARKER,
    }
    if secret_id is not None:
        metadata["secret_id"] = str(secret_id)
    return metadata


class TestGrantInvariant:
    """The lifetime grant never increases, across every failure boundary."""

    async def test_fresh_mint_failure_leaves_recorded_row_then_converges(
        self, seeding_env
    ):
        FakeProxyClient.generate_fail_times = 1

        await _seed_safely()

        row = seeding_env.vault.row
        assert row is not None
        assert (
            service._read_grant_record(row, ORGANIZATION_ID) == 10.0
        )  # durable before the mint
        assert ORGANIZATION_ID not in FakeProxyClient.records

        outcome = await _reconcile()

        assert outcome == "reseeded"
        assert _all_generate_calls()[-1]["max_budget"] == 10.0
        assert (
            service._read_grant_record(seeding_env.vault.row, ORGANIZATION_ID) is None
        )

    async def test_orphan_is_reminted_at_remaining_budget(self, seeding_env):
        FakeProxyClient.seed_record(
            ORGANIZATION_ID, max_budget=10.0, spend=4.0, metadata=_ours_metadata()
        )

        outcome = await _reconcile()

        assert outcome == "reseeded"
        assert _all_delete_calls() == [[ORGANIZATION_ID]]
        assert _all_generate_calls()[-1]["max_budget"] == 6.0
        row = seeding_env.vault.row
        assert row.data.provider.key == FakeProxyClient.records[ORGANIZATION_ID]["key"]

    async def test_delete_then_mint_failure_never_refills_to_full(self, seeding_env):
        FakeProxyClient.seed_record(
            ORGANIZATION_ID, max_budget=10.0, spend=4.0, metadata=_ours_metadata()
        )
        FakeProxyClient.generate_fail_times = 1

        with pytest.raises(ProxyRequestError):  # the attempt failed loudly
            await _reconcile()

        # The old key is gone; only the signed row record knows the remaining.
        assert ORGANIZATION_ID not in FakeProxyClient.records
        assert service._read_grant_record(seeding_env.vault.row, ORGANIZATION_ID) == 6.0

        second = await _reconcile()

        assert second == "reseeded"
        assert _all_generate_calls()[-1]["max_budget"] == 6.0

    async def test_row_without_key_and_without_record_assumes_spent(self, seeding_env):
        await _seed()
        await FakeProxyClient.instances[0].delete_keys(key_aliases=[ORGANIZATION_ID])

        outcome = await _reconcile()

        assert outcome == "grant_unrecoverable"
        assert len(_all_generate_calls()) == 1  # only the original seed mint

    async def test_forged_grant_record_reads_as_absent(self, seeding_env):
        await _seed()
        await FakeProxyClient.instances[0].delete_keys(key_aliases=[ORGANIZATION_ID])
        extras = dict(seeding_env.vault.row.data.provider.extras or {})
        extras[service._GRANT_RECORD_FIELD] = {
            "remaining_usd": 10.0,
            "signature": "forged",
        }
        seeding_env.vault.row.data.provider.extras = extras

        outcome = await _reconcile()

        assert outcome == "grant_unrecoverable"
        assert len(_all_generate_calls()) == 1

    async def test_recorded_remaining_is_clamped_to_policy_grant(self, seeding_env):
        await _seed()
        await FakeProxyClient.instances[0].delete_keys(key_aliases=[ORGANIZATION_ID])
        # A validly signed record can still exceed the current grant (for
        # example after the policy shrank); the mint is clamped.
        extras = dict(seeding_env.vault.row.data.provider.extras or {})
        extras[service._GRANT_RECORD_FIELD] = service._build_grant_record(
            ORGANIZATION_ID, 15.0
        )
        seeding_env.vault.row.data.provider.extras = extras

        outcome = await _reconcile()

        assert outcome == "reseeded"
        assert _all_generate_calls()[-1]["max_budget"] == 10.0

    async def test_exhausted_key_is_blocked_not_reseeded(self, seeding_env):
        FakeProxyClient.seed_record(
            ORGANIZATION_ID, max_budget=10.0, spend=9.995, metadata=_ours_metadata()
        )

        outcome = await _reconcile()

        assert outcome == "exhausted_not_reseeded"
        assert _all_delete_calls() == []
        assert ORGANIZATION_ID in FakeProxyClient.records
        assert _all_block_calls() == [f"hash-{ORGANIZATION_ID}"]
        assert seeding_env.vault.row is None

    async def test_unreadable_key_budget_refuses_to_remint(self, seeding_env):
        FakeProxyClient.seed_record(ORGANIZATION_ID, metadata=_ours_metadata())
        del FakeProxyClient.records[ORGANIZATION_ID]["spend"]

        outcome = await _reconcile()

        assert outcome == "orphan_unverifiable"
        assert _all_delete_calls() == []

    async def test_empty_state_reconcile_never_creates_a_first_grant(self, seeding_env):
        outcome = await _reconcile()

        assert outcome == "never_seeded"
        assert _all_generate_calls() == []
        assert seeding_env.vault.row is None


class TestPairing:
    async def test_exactly_paired_state_is_healthy(self, seeding_env):
        await _seed()

        outcome = await _reconcile()

        assert outcome == "healthy"
        assert len(_all_generate_calls()) == 1

    async def test_unpaired_key_is_repaired_at_its_remaining(self, seeding_env):
        await _seed()
        # Simulate the concurrency scar: a live our-key that references a
        # different (dead) row id.
        FakeProxyClient.records[ORGANIZATION_ID]["metadata"]["secret_id"] = str(uuid4())
        FakeProxyClient.records[ORGANIZATION_ID]["spend"] = 2.0

        outcome = await _reconcile()

        assert outcome == "reseeded"
        assert _all_generate_calls()[-1]["max_budget"] == 8.0
        entry = FakeProxyClient.records[ORGANIZATION_ID]
        assert entry["metadata"]["secret_id"] == str(seeding_env.vault.row.id)
        assert seeding_env.vault.row.data.provider.key == entry["key"]

    async def test_paired_but_unfinalized_row_is_not_healthy(self, seeding_env):
        await _seed()
        # Simulate a crash between mint and finalize: the record is back while
        # the key is already paired.
        extras = dict(seeding_env.vault.row.data.provider.extras or {})
        extras[service._GRANT_RECORD_FIELD] = service._build_grant_record(
            ORGANIZATION_ID, 10.0
        )
        seeding_env.vault.row.data.provider.extras = extras

        outcome = await _reconcile()

        assert outcome == "reseeded"
        assert (
            service._read_grant_record(seeding_env.vault.row, ORGANIZATION_ID) is None
        )
        entry = FakeProxyClient.records[ORGANIZATION_ID]
        assert entry["metadata"]["secret_id"] == str(seeding_env.vault.row.id)


class TestConcurrency:
    async def test_concurrent_seeds_converge_to_one_bounded_pair(self, seeding_env):
        await asyncio.gather(_seed(), _seed(), return_exceptions=True)

        outcome = await _reconcile()

        assert outcome in ("healthy", "reseeded")
        if outcome == "reseeded":
            outcome = await _reconcile()
            assert outcome == "healthy"

        assert len(FakeProxyClient.records) == 1
        entry = FakeProxyClient.records[ORGANIZATION_ID]
        assert entry["max_budget"] <= 10.0
        row = seeding_env.vault.row
        assert entry["metadata"]["secret_id"] == str(row.id)
        assert row.data.provider.key == entry["key"]
        assert service._read_grant_record(row, ORGANIZATION_ID) is None


class TestTimeoutBound:
    async def test_slow_seed_is_bounded_and_alerts(self, seeding_env):
        async def slow_seed(**kwargs):
            await asyncio.sleep(1.0)

        seeding_env.monkeypatch.setattr(service, "_SEED_TIMEOUT_SECONDS", 0.05)
        seeding_env.monkeypatch.setattr(
            service, "seed_starter_credits_bridge", slow_seed
        )

        await _seed_safely()

        assert len(seeding_env.alerts) == 1


class TestTeamCeilingGate:
    @pytest.fixture(autouse=True)
    def armed(self, monkeypatch):
        service._verified_teams.clear()
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.alerts = []
        self.clock = [0.0]

        monkeypatch.setattr(
            service, "_send_alert_background", lambda text: self.alerts.append(text)
        )
        monkeypatch.setattr(service, "_monotonic", lambda: self.clock[0])
        self.monkeypatch = monkeypatch

    def _client(self, payloads):
        """payloads: list consumed one per lookup (last one repeats)."""
        calls = []

        class Client:
            async def get_team_info(self, *, team_id):
                calls.append(team_id)
                payload = payloads[min(len(calls), len(payloads)) - 1]
                if isinstance(payload, Exception):
                    raise payload
                return payload

        client = Client()
        client.calls = calls
        return client

    async def test_sound_ceiling_verifies_and_caches_within_ttl(self):
        client = self._client(
            [
                {
                    "team_id": "team-starter",
                    "team_info": {"max_budget": 500.0, "budget_duration": None},
                }
            ]
        )
        config = env.starter_credits_bridge

        assert await service._team_ceiling_verified(client, config) is True
        self.clock[0] += 100.0
        assert await service._team_ceiling_verified(client, config) is True
        assert client.calls == ["team-starter"]

    async def test_reverifies_after_ttl_and_catches_removed_ceiling(self):
        client = self._client(
            [
                {"team_info": {"max_budget": 500.0, "budget_duration": None}},
                {"team_info": {"max_budget": None, "budget_duration": None}},
            ]
        )
        config = env.starter_credits_bridge

        assert await service._team_ceiling_verified(client, config) is True
        self.clock[0] += service._TEAM_VERIFY_TTL_SECONDS + 1
        assert await service._team_ceiling_verified(client, config) is False
        assert len(client.calls) == 2
        assert len(self.alerts) == 1

    async def test_top_level_budget_fields_also_accepted(self):
        client = self._client([{"team_id": "team-starter", "max_budget": 500.0}])

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is True
        )

    async def test_unreachable_team_refuses(self):
        client = self._client(
            [ProxyRequestError(status_code=404, detail="team not found")]
        )

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is False
        )
        assert len(self.alerts) == 1

    async def test_non_finite_budget_refuses(self):
        client = self._client([{"team_info": {"max_budget": float("inf")}}])

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is False
        )

    async def test_resetting_budget_refuses(self):
        client = self._client(
            [{"team_info": {"max_budget": 500.0, "budget_duration": "30d"}}]
        )

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is False
        )
        assert len(self.alerts) == 1


class TestFeatureFlagGate:
    @pytest.fixture(autouse=True)
    def armed(self, monkeypatch):
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.cache: dict = {}

        async def fake_get_cache(*, namespace, key, retry=False, **kwargs):
            return self.cache.get((namespace, tuple(sorted(key.items()))))

        async def fake_set_cache(*, namespace, key, value, **kwargs):
            self.cache[(namespace, tuple(sorted(key.items())))] = value

        monkeypatch.setattr(service, "get_cache", fake_get_cache)
        monkeypatch.setattr(service, "set_cache", fake_set_cache)
        self.monkeypatch = monkeypatch

    def _posthog(self, decisions):
        return SimpleNamespace(
            feature_enabled=lambda flag, distinct_id: decisions.get(distinct_id)
        )

    def _broken_posthog(self):
        def boom(flag, distinct_id):
            raise RuntimeError("posthog down")

        return SimpleNamespace(feature_enabled=boom)

    async def test_posthog_unavailable_and_no_cache_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: None)

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False

    async def test_outage_fallback_is_per_organization(self):
        organization_a, organization_b, organization_c = "org-a", "org-b", "org-c"
        self.monkeypatch.setattr(
            service,
            "_load_posthog",
            lambda: self._posthog({organization_a: True, organization_b: False}),
        )
        assert await service._feature_flag_enabled(organization_a) is True
        assert await service._feature_flag_enabled(organization_b) is False

        self.monkeypatch.setattr(service, "_load_posthog", self._broken_posthog)

        # Each organization keeps ITS decision; an unknown one fails closed.
        assert await service._feature_flag_enabled(organization_a) is True
        assert await service._feature_flag_enabled(organization_b) is False
        assert await service._feature_flag_enabled(organization_c) is False

    async def test_no_signal_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: self._posthog({}))

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False


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
    def armed(self, monkeypatch):
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.cache: dict = {}
        self.alerts = []

        async def fake_get_cache(*, namespace, key, retry=False, **kwargs):
            return self.cache.get((namespace, tuple(sorted(key.items()))))

        async def fake_set_cache(*, namespace, key, value, **kwargs):
            self.cache[(namespace, tuple(sorted(key.items())))] = value

        monkeypatch.setattr(service, "get_cache", fake_get_cache)
        monkeypatch.setattr(service, "set_cache", fake_set_cache)
        monkeypatch.setattr(
            service, "_send_alert_background", lambda text: self.alerts.append(text)
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
            service, "_load_posthog", lambda: self._posthog_with(dict(self._PAYLOAD))
        )

        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.global_daily == 4
        assert policy.grant_usd == 10.0
        assert policy.key_rpm_limit == 30
        assert len(self.cache) == 1

    async def test_json_string_payload_parses(self):
        import json

        self.monkeypatch.setattr(
            service,
            "_load_posthog",
            lambda: self._posthog_with(json.dumps(self._PAYLOAD)),
        )

        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.global_hourly == 3

    async def test_env_overrides_take_precedence(self):
        self.monkeypatch.setattr(
            env,
            "starter_credits_bridge",
            _armed_config(grant_usd=7.5, freemail_domains=["other.test"]),
        )
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(dict(self._PAYLOAD))
        )

        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.grant_usd == 7.5
        assert policy.freemail_domains == ["other.test"]

    async def test_no_signal_anywhere_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: None)

        assert await service._resolve_mint_policy() is None

    async def test_incomplete_payload_fails_closed(self):
        partial = dict(self._PAYLOAD)
        del partial["grant_usd"]
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(partial)
        )

        assert await service._resolve_mint_policy() is None

    async def test_unknown_payload_field_fails_closed(self):
        payload = dict(self._PAYLOAD)
        payload["surprise"] = 1
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(payload)
        )

        assert await service._resolve_mint_policy() is None

    async def test_non_finite_grant_fails_closed(self):
        payload = dict(self._PAYLOAD)
        payload["grant_usd"] = float("inf")
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(payload)
        )

        assert await service._resolve_mint_policy() is None

    async def test_outage_falls_back_to_cached_payload(self):
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(dict(self._PAYLOAD))
        )
        assert await service._resolve_mint_policy() is not None

        self.monkeypatch.setattr(service, "_load_posthog", self._broken_posthog)
        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.global_daily == 4

    async def test_malformed_live_payload_fails_closed_despite_cache(self):
        # A cached valid payload may stand in for an OUTAGE only, never for a
        # malformed live response (a bad rollout must fail closed, loudly).
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(dict(self._PAYLOAD))
        )
        assert await service._resolve_mint_policy() is not None

        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with("{not json")
        )

        assert await service._resolve_mint_policy() is None
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
    def armed(self, monkeypatch):
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.engine = FakeCacheEngine()
        monkeypatch.setattr(service, "get_cache_engine", lambda: self.engine)
        self.monkeypatch = monkeypatch

    async def test_freemail_skips_domain_counter_and_digit_rule(self):
        assert (
            await service._mint_policy_allows("john99@freemail.test", _policy()) is True
        )
        assert len(self.engine.counts) == 2
        assert not any("domain" in key for key in self.engine.counts)

    async def test_work_domain_digit_local_refused_before_counters(self):
        assert await service._mint_policy_allows("john99@acme.test", _policy()) is False
        assert self.engine.counts == {}

    async def test_work_domain_daily_cap_blocks(self):
        assert await service._mint_policy_allows("alice@acme.test", _policy()) is True
        assert await service._mint_policy_allows("bob@acme.test", _policy()) is False

    async def test_digit_rule_can_be_disabled_by_policy(self):
        policy = _policy(block_digit_locals=False)

        assert await service._mint_policy_allows("john99@acme.test", policy) is True

    async def test_global_hourly_cap_blocks(self):
        policy = _policy(global_hourly=2)

        assert await service._mint_policy_allows("a@freemail.test", policy) is True
        assert await service._mint_policy_allows("b@freemail.test", policy) is True
        assert await service._mint_policy_allows("c@freemail.test", policy) is False

    async def test_global_daily_cap_blocks(self):
        policy = _policy(global_daily=1, global_hourly=10)

        assert await service._mint_policy_allows("a@freemail.test", policy) is True
        assert await service._mint_policy_allows("b@freemail.test", policy) is False

    async def test_redis_error_fails_closed(self):
        self.engine.error = ConnectionError("redis down")

        assert await service._mint_policy_allows("a@freemail.test", _policy()) is False

    async def test_release_hands_slots_back(self):
        policy = _policy()
        assert await service._mint_policy_allows("a@freemail.test", policy) is True

        await service._release_velocity_slots("a@freemail.test", policy)

        assert all(count == 0 for count in self.engine.counts.values())


class TestAdminRouter:
    async def test_reconcile_route_returns_outcome(self, monkeypatch):
        from ee.src.apis.fastapi.starter_credits_bridge import router as admin_router

        seen = {}

        async def fake_reconcile(*, organization_id):
            seen["organization_id"] = organization_id
            return "healthy"

        monkeypatch.setattr(
            admin_router, "reconcile_starter_credits_bridge", fake_reconcile
        )

        instance = admin_router.StarterCreditsBridgeAdminRouter()
        response = await instance.reconcile(
            admin_router.StarterCreditsReconcileRequest(organization_id=ORGANIZATION_ID)
        )

        assert seen["organization_id"] == ORGANIZATION_ID
        assert response.status_code == 200
        assert b"healthy" in response.body


class TestManagedAndWriteOnlyRow:
    """The seeded connection is Agenta's from creation: unreadable and undeletable.

    `managed_by` refuses user deletes and re-credentialing; `write_only` keeps the proxy
    virtual key out of every user-facing read. Both ride the CREATE, so the row is never
    briefly readable or removable, and every later write by this component carries the
    owner flag that gets it past the managed guard.
    """

    async def test_the_row_is_created_managed_and_write_only(self, seeding_env):
        await _seed()

        create_dto = seeding_env.vault.create_dto
        assert create_dto is not None
        assert create_dto.managed_by == service.ORIGIN_MARKER
        assert create_dto.write_only is True

        assert seeding_env.vault.row.managed_by == service.ORIGIN_MARKER
        assert seeding_env.vault.row.write_only is True

    async def test_every_update_carries_the_owner_flag(self, seeding_env):
        await _seed()

        # Row-first seeding writes the grant record, then finalizes with the minted key.
        assert seeding_env.vault.update_allow_managed
        assert all(seeding_env.vault.update_allow_managed)

    async def test_reconcile_updates_also_carry_the_owner_flag(self, seeding_env):
        await _seed()
        seeding_env.vault.update_allow_managed.clear()

        # The concurrency scar from `test_unpaired_key_is_repaired_at_its_remaining`:
        # reconcile re-mints and writes the new key back into the managed row.
        FakeProxyClient.records[ORGANIZATION_ID]["metadata"]["secret_id"] = str(uuid4())
        FakeProxyClient.records[ORGANIZATION_ID]["spend"] = 2.0

        assert await _reconcile() == "reseeded"
        assert seeding_env.vault.update_allow_managed
        assert all(seeding_env.vault.update_allow_managed)

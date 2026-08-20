"""Unit tests for the starter-credits-bridge seeding service
(``ee.src.core.starter_credits_bridge.service``): gating, team-ceiling refusal,
idempotency, convergence of partial states, velocity caps, and failure
isolation, with every external dependency stubbed."""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.utils.env import env, StarterCreditsBridgeConfig
from oss.src.core.secrets.dtos import SecretKind
from oss.src.core.secrets.enums import CustomProviderKind

from ee.src.core.starter_credits_bridge import service
from ee.src.core.starter_credits_bridge.types import (
    KeyAliasExistsError,
    MintedKey,
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
        grant_usd=10.0,
        model_id="vertex_ai/some-model",
    )
    values.update(overrides)
    return StarterCreditsBridgeConfig(**values)


def _our_row():
    return SimpleNamespace(
        id=uuid4(),
        header=SimpleNamespace(description=service.ORIGIN_MARKER),
    )


class FakeVaultService:
    def __init__(self):
        self.row = None
        self.created = []
        self.deleted = []
        self.fail_next_create = False

    async def get_secret_by_slug(self, secret_slug, project_id=None, **kwargs):
        assert secret_slug == service.STARTER_CREDITS_SLUG
        return self.row

    async def create_secret(self, *, project_id, create_secret_dto):
        if self.fail_next_create:
            self.fail_next_create = False
            raise RuntimeError("vault write failed")
        created = SimpleNamespace(
            id=uuid4(),
            dto=create_secret_dto,
            header=SimpleNamespace(description=create_secret_dto.header.description),
        )
        self.created.append((project_id, create_secret_dto, created.id))
        self.row = created
        return created

    async def delete_secret(self, *, secret_id, project_id=None, **kwargs):
        self.deleted.append(secret_id)
        if self.row is not None and self.row.id == secret_id:
            self.row = None


class FakeProxyClient:
    """Stands in for StarterCreditsProxyClient with a real alias registry, so
    partial-state convergence (alias exists -> delete -> re-mint) is exercised."""

    aliases: set = set()
    list_result: list = []
    instances: list = []

    def __init__(self, *, base_url, master_key):
        self.base_url = base_url
        self.master_key = master_key
        self.generate_calls = []
        self.delete_calls = []
        self.update_calls = []
        FakeProxyClient.instances.append(self)

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
        if key_alias in FakeProxyClient.aliases:
            raise KeyAliasExistsError(status_code=400, detail="alias exists")
        FakeProxyClient.aliases.add(key_alias)
        return MintedKey(
            key=f"sk-virtual-{len(self.generate_calls)}", key_alias=key_alias
        )

    async def delete_keys(self, *, key_aliases):
        self.delete_calls.append(list(key_aliases))
        FakeProxyClient.aliases -= set(key_aliases)

    async def update_key(self, *, key, metadata):
        self.update_calls.append(dict(key=key, metadata=metadata))

    async def list_keys(self, *, key_alias):
        return list(FakeProxyClient.list_result)


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


def _all_update_calls():
    return [
        call for instance in FakeProxyClient.instances for call in instance.update_calls
    ]


@pytest.fixture
def seeding_env(monkeypatch):
    """Arm the config and stub every dependency; returns the mutable stubs."""
    FakeProxyClient.aliases = set()
    FakeProxyClient.list_result = []
    FakeProxyClient.instances = []
    service._verified_team_ids.clear()

    config = _armed_config()
    monkeypatch.setattr(env, "starter_credits_bridge", config)

    project = SimpleNamespace(id=uuid4())
    vault = FakeVaultService()
    invalidated = []
    alerts = []

    async def fake_get_default_project(organization_id):
        assert organization_id == ORGANIZATION_ID
        return project

    async def fake_flag_enabled(organization_id):
        return True

    async def fake_team_verified(client, config):
        return True

    async def fake_velocity(organization_email):
        return True

    async def fake_invalidate_cache(**kwargs):
        invalidated.append(kwargs)

    async def fake_send_alert(text):
        alerts.append(text)

    monkeypatch.setattr(
        service.db_manager,
        "get_default_project_by_organization_id",
        fake_get_default_project,
    )
    monkeypatch.setattr(service, "_vault_service", lambda: vault)
    monkeypatch.setattr(service, "_feature_flag_enabled", fake_flag_enabled)
    monkeypatch.setattr(service, "_team_ceiling_verified", fake_team_verified)
    monkeypatch.setattr(service, "_within_velocity_limits", fake_velocity)
    monkeypatch.setattr(service, "invalidate_cache", fake_invalidate_cache)
    monkeypatch.setattr(service, "_send_alert", fake_send_alert)
    monkeypatch.setattr(service, "StarterCreditsProxyClient", FakeProxyClient)

    return SimpleNamespace(
        config=config,
        project=project,
        vault=vault,
        invalidated=invalidated,
        alerts=alerts,
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


class TestSeeding:
    async def test_happy_path_mints_seeds_and_marks_ownership(self, seeding_env):
        await _seed()

        (call,) = _all_generate_calls()
        assert call["key_alias"] == ORGANIZATION_ID
        assert call["max_budget"] == 10.0
        assert call["models"] == ["vertex_ai/some-model"]
        assert call["team_id"] == "team-starter"
        assert call["max_parallel_requests"] == 2
        assert call["rpm_limit"] == 30
        assert call["tpm_limit"] == 200_000
        assert call["metadata"] == {
            "organization_id": ORGANIZATION_ID,
            "origin": service.ORIGIN_MARKER,
        }

        ((project_id, dto, created_id),) = seeding_env.vault.created
        assert project_id == seeding_env.project.id
        assert dto.slug == service.STARTER_CREDITS_SLUG
        assert dto.header.name == service.STARTER_CREDITS_NAME
        assert dto.header.description == service.ORIGIN_MARKER
        assert dto.secret.kind == SecretKind.CUSTOM_PROVIDER
        assert dto.secret.data.kind == CustomProviderKind.CUSTOM
        assert dto.secret.data.provider.url == "https://credits-proxy.example.test"
        assert dto.secret.data.provider.key == "sk-virtual-1"
        assert len(dto.secret.data.models) == 1
        assert dto.secret.data.models[0].slug == "vertex_ai/some-model"

        (update,) = _all_update_calls()
        assert update["key"] == "sk-virtual-1"
        assert update["metadata"]["secret_id"] == str(created_id)
        assert update["metadata"]["origin"] == service.ORIGIN_MARKER

        assert seeding_env.invalidated == [{"project_id": str(seeding_env.project.id)}]

    async def test_disarmed_config_is_a_noop(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "starter_credits_bridge", _armed_config(enabled=False)
        )

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.created == []

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
        assert seeding_env.vault.created == []

    async def test_unverified_team_refuses_to_seed(self, seeding_env):
        async def team_unverified(client, config):
            return False

        seeding_env.monkeypatch.setattr(
            service, "_team_ceiling_verified", team_unverified
        )

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.created == []

    async def test_existing_seed_is_idempotent_no_second_mint(self, seeding_env):
        seeding_env.vault.row = _our_row()

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.created == []

    async def test_velocity_cap_skips_mint(self, seeding_env):
        async def over_limit(organization_email):
            return False

        seeding_env.monkeypatch.setattr(service, "_within_velocity_limits", over_limit)

        await _seed()

        assert _all_generate_calls() == []
        assert seeding_env.vault.created == []

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
        assert seeding_env.vault.created == []


class TestConvergence:
    async def test_orphaned_key_is_deleted_and_reminted(self, seeding_env):
        FakeProxyClient.aliases.add(ORGANIZATION_ID)

        await _seed()

        assert _all_delete_calls() == [[ORGANIZATION_ID]]
        assert len(_all_generate_calls()) == 2
        assert len(seeding_env.vault.created) == 1

    async def test_mint_ok_vault_fail_then_next_call_converges(self, seeding_env):
        seeding_env.vault.fail_next_create = True

        await _seed_safely()

        assert seeding_env.vault.created == []
        assert len(seeding_env.alerts) == 1

        await _seed_safely()

        # mint, alias-exists on retry, delete, re-mint, then a good vault write
        assert len(seeding_env.vault.created) == 1
        assert _all_delete_calls() == [[ORGANIZATION_ID]]
        assert len(_all_generate_calls()) == 3

    async def test_double_entry_is_idempotent(self, seeding_env):
        await _seed()
        await _seed()

        assert len(_all_generate_calls()) == 1
        assert len(seeding_env.vault.created) == 1

    async def test_proxy_failure_is_swallowed_and_alerts(self, seeding_env):
        async def broken_mint(self, **kwargs):
            raise ProxyRequestError(status_code=500, detail="boom")

        seeding_env.monkeypatch.setattr(
            FakeProxyClient, "generate_key", broken_mint, raising=False
        )

        await _seed_safely()

        assert seeding_env.vault.created == []
        assert seeding_env.invalidated == []
        assert len(seeding_env.alerts) == 1

    async def test_slow_seed_is_bounded_by_timeout(self, seeding_env):
        async def slow_seed(**kwargs):
            await asyncio.sleep(1.0)

        seeding_env.monkeypatch.setattr(service, "_SEED_TIMEOUT_SECONDS", 0.05)
        seeding_env.monkeypatch.setattr(
            service, "seed_starter_credits_bridge", slow_seed
        )

        await _seed_safely()

        assert len(seeding_env.alerts) == 1


class TestReconcile:
    async def test_disarmed_returns_disabled(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "starter_credits_bridge", _armed_config(enabled=False)
        )

        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "disabled"

    async def test_healthy_state_is_untouched(self, seeding_env):
        seeding_env.vault.row = _our_row()
        FakeProxyClient.list_result = [
            {"metadata": {"origin": service.ORIGIN_MARKER}},
        ]

        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "healthy"
        assert _all_generate_calls() == []
        assert seeding_env.vault.deleted == []

    async def test_nothing_seeded_seeds(self, seeding_env):
        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "seeded"
        assert len(seeding_env.vault.created) == 1

    async def test_orphaned_key_without_row_is_replaced(self, seeding_env):
        FakeProxyClient.aliases.add(ORGANIZATION_ID)
        FakeProxyClient.list_result = [
            {"metadata": {"origin": service.ORIGIN_MARKER}},
        ]

        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "reseeded"
        assert _all_delete_calls() == [[ORGANIZATION_ID]]
        assert len(seeding_env.vault.created) == 1

    async def test_our_row_without_key_is_replaced(self, seeding_env):
        row = _our_row()
        seeding_env.vault.row = row

        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "reseeded"
        assert seeding_env.vault.deleted == [row.id]
        assert len(seeding_env.vault.created) == 1

    async def test_foreign_row_without_key_is_left_alone(self, seeding_env):
        seeding_env.vault.row = SimpleNamespace(
            id=uuid4(),
            header=SimpleNamespace(description=None),
        )

        outcome = await service.reconcile_starter_credits_bridge(
            organization_id=ORGANIZATION_ID
        )

        assert outcome == "foreign_row"
        assert seeding_env.vault.deleted == []
        assert _all_generate_calls() == []


class TestTeamCeilingGate:
    @pytest.fixture(autouse=True)
    def armed(self, monkeypatch):
        service._verified_team_ids.clear()
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.alerts = []

        async def fake_send_alert(text):
            self.alerts.append(text)

        monkeypatch.setattr(service, "_send_alert", fake_send_alert)
        self.monkeypatch = monkeypatch

    def _client(self, payload=None, error=None):
        calls = []

        class Client:
            async def get_team_info(self, *, team_id):
                calls.append(team_id)
                if error is not None:
                    raise error
                return payload

        client = Client()
        client.calls = calls
        return client

    async def test_sound_ceiling_verifies_and_caches(self):
        client = self._client(
            payload={"team_info": {"max_budget": 500.0, "budget_duration": None}}
        )
        config = env.starter_credits_bridge

        assert await service._team_ceiling_verified(client, config) is True
        assert await service._team_ceiling_verified(client, config) is True
        assert client.calls == ["team-starter"]

    async def test_unreachable_team_refuses(self):
        client = self._client(
            error=ProxyRequestError(status_code=404, detail="team not found")
        )

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is False
        )
        assert len(self.alerts) == 1

    async def test_missing_budget_refuses(self):
        client = self._client(payload={"team_info": {"max_budget": None}})

        assert (
            await service._team_ceiling_verified(client, env.starter_credits_bridge)
            is False
        )
        assert len(self.alerts) == 1

    async def test_resetting_budget_refuses(self):
        client = self._client(
            payload={"team_info": {"max_budget": 500.0, "budget_duration": "30d"}}
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
        self.cache_writes: list = []

        async def fake_get_cache(*, namespace, key, retry=False, **kwargs):
            return self.cache.get((namespace, tuple(sorted(key.items()))))

        async def fake_set_cache(*, namespace, key, value, **kwargs):
            self.cache[(namespace, tuple(sorted(key.items())))] = value
            self.cache_writes.append(value)

        monkeypatch.setattr(service, "get_cache", fake_get_cache)
        monkeypatch.setattr(service, "set_cache", fake_set_cache)
        self.monkeypatch = monkeypatch

    def _posthog(self, result):
        return SimpleNamespace(feature_enabled=lambda flag, distinct_id: result)

    def _broken_posthog(self):
        def boom(flag, distinct_id):
            raise RuntimeError("posthog down")

        return SimpleNamespace(feature_enabled=boom)

    async def test_posthog_unavailable_and_no_cache_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: None)

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False

    async def test_flag_true_enables_and_caches(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: self._posthog(True))

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is True
        assert self.cache_writes == [True]

    async def test_no_signal_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: self._posthog(None))

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False

    async def test_lookup_error_without_cache_fails_closed(self):
        self.monkeypatch.setattr(service, "_load_posthog", self._broken_posthog)

        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False

    async def test_lookup_error_falls_back_to_cached_value(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: self._posthog(True))
        assert await service._feature_flag_enabled(ORGANIZATION_ID) is True

        self.monkeypatch.setattr(service, "_load_posthog", self._broken_posthog)
        assert await service._feature_flag_enabled(ORGANIZATION_ID) is True

    async def test_cached_off_stays_off_during_outage(self):
        self.monkeypatch.setattr(service, "_load_posthog", lambda: self._posthog(False))
        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False

        self.monkeypatch.setattr(service, "_load_posthog", self._broken_posthog)
        assert await service._feature_flag_enabled(ORGANIZATION_ID) is False


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

    async def expire(self, key, ttl):
        self.expired.append((key, ttl))


class TestVelocityLimits:
    @pytest.fixture(autouse=True)
    def armed(self, monkeypatch):
        monkeypatch.setattr(
            env,
            "starter_credits_bridge",
            _armed_config(daily_mint_cap=2, domain_daily_mint_cap=1),
        )
        self.monkeypatch = monkeypatch

    async def test_under_caps_allows_and_sets_expiry(self):
        engine = FakeCacheEngine()
        self.monkeypatch.setattr(service, "get_cache_engine", lambda: engine)

        assert await service._within_velocity_limits(ORGANIZATION_EMAIL) is True
        assert len(engine.expired) == 2

    async def test_domain_cap_blocks_second_mint_for_same_domain(self):
        engine = FakeCacheEngine()
        self.monkeypatch.setattr(service, "get_cache_engine", lambda: engine)

        assert await service._within_velocity_limits(ORGANIZATION_EMAIL) is True
        assert await service._within_velocity_limits(ORGANIZATION_EMAIL) is False

    async def test_global_cap_blocks_across_domains(self):
        engine = FakeCacheEngine()
        self.monkeypatch.setattr(service, "get_cache_engine", lambda: engine)

        assert await service._within_velocity_limits("a@one.test") is True
        assert await service._within_velocity_limits("b@two.test") is True
        assert await service._within_velocity_limits("c@three.test") is False

    async def test_redis_error_fails_closed(self):
        engine = FakeCacheEngine(error=ConnectionError("redis down"))
        self.monkeypatch.setattr(service, "get_cache_engine", lambda: engine)

        assert await service._within_velocity_limits(ORGANIZATION_EMAIL) is False


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

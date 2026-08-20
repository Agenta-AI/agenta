"""Unit tests for the funded-credits seeding service
(``ee.src.core.funded_credits.service``): gating, idempotency, velocity caps,
and failure isolation, with every external dependency stubbed."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.utils.env import env, FundedCreditsConfig
from oss.src.core.secrets.dtos import SecretKind
from oss.src.core.secrets.enums import CustomProviderKind

from ee.src.core.funded_credits import service
from ee.src.core.funded_credits.types import (
    KeyAliasExistsError,
    MintedKey,
    ProxyRequestError,
)


ORGANIZATION_ID = "9f0e0f39-0000-4000-8000-000000000001"
ORGANIZATION_EMAIL = "someone@example.com"


def _armed_config(**overrides) -> FundedCreditsConfig:
    values = dict(
        enabled=True,
        proxy_url="https://proxy.internal.test",
        connection_url="https://credits.example.test/v1",
        master_key="sk-master-test",
        grant_usd=10.0,
        model="some-model",
        team_id=None,
        rpm_limit=None,
        tpm_limit=None,
    )
    values.update(overrides)
    return FundedCreditsConfig(**values)


class FakeVaultService:
    def __init__(self, existing_secret=None):
        self.existing_secret = existing_secret
        self.created = []

    async def get_secret_by_slug(self, secret_slug, project_id=None, **kwargs):
        assert secret_slug == service.STARTER_CREDITS_SLUG
        return self.existing_secret

    async def create_secret(self, *, project_id, create_secret_dto):
        self.created.append((project_id, create_secret_dto))
        return create_secret_dto


class FakeProxyClient:
    """Stands in for FundedCreditsProxyClient; records construction and calls."""

    instances: list = []
    generate_error: Exception | None = None

    def __init__(self, *, base_url, master_key):
        self.base_url = base_url
        self.master_key = master_key
        self.generate_calls = []
        FakeProxyClient.instances.append(self)

    async def generate_key(self, **kwargs):
        self.generate_calls.append(kwargs)
        if FakeProxyClient.generate_error is not None:
            raise FakeProxyClient.generate_error
        return MintedKey(key="sk-virtual-abc", key_alias=kwargs["key_alias"])


@pytest.fixture
def seeding_env(monkeypatch):
    """Arm the config and stub every dependency; returns the mutable stubs."""
    FakeProxyClient.instances = []
    FakeProxyClient.generate_error = None

    config = _armed_config()
    monkeypatch.setattr(env, "funded_credits", config)

    project = SimpleNamespace(id=uuid4())
    vault = FakeVaultService()
    invalidated = []

    async def fake_get_default_project(organization_id):
        assert organization_id == ORGANIZATION_ID
        return project

    async def fake_flag_enabled(organization_id):
        return True

    async def fake_velocity(organization_email):
        return True

    async def fake_invalidate_cache(**kwargs):
        invalidated.append(kwargs)

    monkeypatch.setattr(
        service.db_manager,
        "get_default_project_by_organization_id",
        fake_get_default_project,
    )
    monkeypatch.setattr(service, "_vault_service", lambda: vault)
    monkeypatch.setattr(service, "_feature_flag_enabled", fake_flag_enabled)
    monkeypatch.setattr(service, "_within_velocity_limits", fake_velocity)
    monkeypatch.setattr(service, "invalidate_cache", fake_invalidate_cache)
    monkeypatch.setattr(service, "FundedCreditsProxyClient", FakeProxyClient)

    return SimpleNamespace(
        config=config,
        project=project,
        vault=vault,
        invalidated=invalidated,
        monkeypatch=monkeypatch,
    )


async def _seed():
    await service.seed_funded_credits(
        organization_id=ORGANIZATION_ID,
        organization_email=ORGANIZATION_EMAIL,
    )


class TestSeeding:
    async def test_happy_path_mints_and_seeds_vault(self, seeding_env):
        await _seed()

        assert len(FakeProxyClient.instances) == 1
        client = FakeProxyClient.instances[0]
        assert client.base_url == "https://proxy.internal.test"

        (call,) = client.generate_calls
        assert call["key_alias"] == ORGANIZATION_ID
        assert call["max_budget"] == 10.0
        assert call["models"] == ["some-model"]
        assert call["metadata"] == {"organization_id": ORGANIZATION_ID}

        ((project_id, dto),) = seeding_env.vault.created
        assert project_id == seeding_env.project.id
        assert dto.slug == service.STARTER_CREDITS_SLUG
        assert dto.header.name == service.STARTER_CREDITS_NAME
        assert dto.secret.kind == SecretKind.CUSTOM_PROVIDER
        assert dto.secret.data.kind == CustomProviderKind.CUSTOM
        assert dto.secret.data.provider.url == "https://credits.example.test/v1"
        assert dto.secret.data.provider.key == "sk-virtual-abc"
        assert len(dto.secret.data.models) == 1
        assert dto.secret.data.models[0].slug == "some-model"

        assert seeding_env.invalidated == [{"project_id": str(seeding_env.project.id)}]

    async def test_disarmed_config_is_a_noop(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "funded_credits", _armed_config(enabled=False)
        )

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.created == []

    async def test_missing_credentials_is_a_noop(self, seeding_env):
        seeding_env.monkeypatch.setattr(
            env, "funded_credits", _armed_config(master_key=None)
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

    async def test_existing_seed_is_idempotent_no_second_mint(self, seeding_env):
        seeding_env.vault.existing_secret = object()

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.created == []

    async def test_velocity_cap_skips_mint(self, seeding_env):
        async def over_limit(organization_email):
            return False

        seeding_env.monkeypatch.setattr(service, "_within_velocity_limits", over_limit)

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.created == []

    async def test_proxy_failure_is_swallowed(self, seeding_env):
        FakeProxyClient.generate_error = ProxyRequestError(
            status_code=500, detail="boom"
        )

        await service.seed_funded_credits_safely(
            organization_id=ORGANIZATION_ID,
            organization_email=ORGANIZATION_EMAIL,
        )

        assert seeding_env.vault.created == []
        assert seeding_env.invalidated == []

    async def test_alias_exists_skips_vault_write_without_raising(self, seeding_env):
        FakeProxyClient.generate_error = KeyAliasExistsError(
            status_code=400, detail="alias exists"
        )

        await _seed()

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

        assert FakeProxyClient.instances == []


class TestFeatureFlagGate:
    @pytest.fixture(autouse=True)
    def armed(self, monkeypatch):
        monkeypatch.setattr(env, "funded_credits", _armed_config())
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
            "funded_credits",
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

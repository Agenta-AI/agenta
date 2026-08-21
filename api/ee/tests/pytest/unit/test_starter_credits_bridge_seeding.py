"""Unit tests for the starter-credits-bridge seeding service
(``ee.src.core.starter_credits_bridge.service``): gating, team-ceiling refusal,
the mint-then-write seed and its failure behavior (transient retry, orphan
blocking, alias conflicts), policy resolution, and velocity caps, with every
external dependency stubbed."""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.utils.env import env, PostHogConfig, StarterCreditsBridgeConfig
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import CustomProviderKind

from ee.src.core.starter_credits_bridge import service
from ee.src.core.starter_credits_bridge.types import (
    KeyAliasExistsError,
    MintedKey,
    MintPolicy,
    ProxyRequestError,
)


# Captured before any fixture replaces it, so the one end-to-end policy test below
# can run the real resolver.
_REAL_RESOLVE_MINT_POLICY = service._resolve_mint_policy

ORGANIZATION_ID = "9f0e0f39-0000-4000-8000-000000000001"
ORGANIZATION_EMAIL = "someone@example.com"


def _armed_config(**overrides) -> StarterCreditsBridgeConfig:
    values = dict(
        enabled=True,
        proxy_public_url="https://credits-proxy.example.test",
        proxy_admin_url="http://litellm-proxy:4000",
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
        self.create_dto = None
        self.create_error = None

    async def get_secret_by_slug(self, secret_slug, project_id=None, **kwargs):
        assert secret_slug == service.STARTER_CREDITS_SLUG
        return self.row

    async def create_secret(self, *, project_id, create_secret_dto):
        await asyncio.sleep(0)
        if self.create_error is not None:
            raise self.create_error
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


class FakeProxyClient:
    """Stands in for StarterCreditsProxyClient with a per-alias key registry, so
    the alias conflict that guards the one-key-per-organization invariant is
    exercised against realistic proxy state."""

    records: dict = {}
    generate_failures: list = []
    instances: list = []

    def __init__(self, *, base_url, master_key):
        self.base_url = base_url
        self.master_key = master_key
        self.generate_calls = []
        self.block_calls = []
        FakeProxyClient.instances.append(self)

    @classmethod
    def fail_generate(cls, times: int, *, status_code: int = 500):
        """Queue `times` mint failures before the next success."""
        cls.generate_failures = [
            ProxyRequestError(status_code=status_code, detail="mint failed")
            for _ in range(times)
        ]

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
        if FakeProxyClient.generate_failures:
            raise FakeProxyClient.generate_failures.pop(0)
        if key_alias in FakeProxyClient.records:
            raise KeyAliasExistsError(status_code=400, detail="already exists: alias")
        value = f"sk-virtual-{uuid4().hex[:8]}"
        FakeProxyClient.records[key_alias] = {
            "key_alias": key_alias,
            "key": value,
            "max_budget": max_budget,
            "spend": 0.0,
            "metadata": dict(metadata),
        }
        return MintedKey(key=value, key_alias=key_alias)

    async def block_key(self, *, key):
        self.block_calls.append(key)


def _all_generate_calls():
    return [
        call
        for instance in FakeProxyClient.instances
        for call in instance.generate_calls
    ]


def _all_block_calls():
    return [
        call for instance in FakeProxyClient.instances for call in instance.block_calls
    ]


@pytest.fixture
def seeding_env(monkeypatch):
    """Arm the config and stub every dependency; returns the mutable stubs."""
    FakeProxyClient.records = {}
    FakeProxyClient.generate_failures = []
    FakeProxyClient.instances = []
    service._verified_teams.clear()

    config = _armed_config()
    monkeypatch.setattr(env, "starter_credits_bridge", config)
    # A deployment that can issue a credential able to read the write-only row it seeds;
    # the refusal when it cannot is its own test below.
    monkeypatch.setattr(env.agenta, "services_internal_key", "runtime-key-for-tests")
    monkeypatch.setattr(service, "_runtime_key_alerted", False)
    # The retry backoff is behavior under test only for its shape, not its wall time.
    monkeypatch.setattr(service, "_MINT_RETRY_BACKOFF_SECONDS", 0.0)

    project = SimpleNamespace(id=uuid4())
    vault = FakeVaultService()
    invalidated = []
    alerts = []
    released = []
    policy = _policy()

    async def fake_get_default_project(organization_id):
        assert organization_id == ORGANIZATION_ID
        return project

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


class TestSeeding:
    async def test_happy_path_mints_then_writes_the_row(self, seeding_env):
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
        assert call["metadata"] == {
            "organization_id": ORGANIZATION_ID,
            "origin": service.ORIGIN_MARKER,
        }

        assert row.data.kind == CustomProviderKind.CUSTOM
        # The row carries the PUBLIC address: a sandboxed run dials it from
        # outside, while minting used the internal admin one.
        assert row.data.provider.url == "https://credits-proxy.example.test"
        (client,) = FakeProxyClient.instances
        assert client.base_url == "http://litellm-proxy:4000"
        assert row.data.provider.key.startswith("sk-virtual-")
        assert row.data.provider.key == FakeProxyClient.records[ORGANIZATION_ID]["key"]
        assert [model.slug for model in row.data.models] == ["vertex_ai/some-model"]
        assert row.header.name == service.STARTER_CREDITS_NAME
        assert seeding_env.invalidated == [{"project_id": str(seeding_env.project.id)}]
        assert seeding_env.released == []

    async def test_the_seeded_row_keys_its_models_under_the_display_name(
        self, seeding_env
    ):
        # The display name is the namespace half of every model key this connection
        # publishes, and a key is permanent once a config references it: a row seeded
        # with no `provider_slug` published "None/custom/<model>" forever.
        await _seed()

        created = seeding_env.vault.create_dto
        # `mode="json"` is the shape the row is stored and read back in.
        response = SecretResponseDTO(
            id=uuid4(),
            slug=service.STARTER_CREDITS_SLUG,
            kind=created.secret.kind,
            data=created.secret.data.model_dump(mode="json"),
            header=created.header,
        )

        assert response.data.model_keys == [
            f"{service.STARTER_CREDITS_NAME}/custom/vertex_ai/some-model"
        ]

    async def test_the_resolver_reads_the_seeded_keys_and_strips_the_namespace(
        self, seeding_env
    ):
        # The resolver takes the STORED keys as they are (it only rebuilds when a row
        # has none), and strips the namespace off the chosen one to get the model id
        # the harness runs. So the namespace the row was seeded with is the namespace
        # the runtime sees, and it has to be the display name.
        from agenta.sdk.agents.connections import ModelRef
        from agenta.sdk.agents.platform import connections

        await _seed()

        created = seeding_env.vault.create_dto
        stored = SecretResponseDTO(
            id=uuid4(),
            slug=service.STARTER_CREDITS_SLUG,
            kind=created.secret.kind,
            data=created.secret.data.model_dump(mode="json"),
            header=created.header,
        )
        # The row as the vault routes return it, model keys included.
        (candidate,) = connections._catalog([stored.model_dump(mode="json")])

        assert candidate.model_keys == {
            f"{service.STARTER_CREDITS_NAME}/custom/vertex_ai/some-model"
        }

        model = ModelRef(
            model=f"{service.STARTER_CREDITS_NAME}/custom/vertex_ai/some-model",
            connection={"mode": "agenta", "slug": service.STARTER_CREDITS_SLUG},
        )
        assert candidate.matches_model(model) is True
        assert candidate.selected_model_id(model) == "vertex_ai/some-model"

    async def test_a_deployment_without_posthog_still_seeds(self, seeding_env):
        # The development-policy path end to end: a local stack has no way to publish
        # a payload, and a signup there must still get its funded connection.
        seeding_env.monkeypatch.setattr(
            service, "_resolve_mint_policy", _REAL_RESOLVE_MINT_POLICY
        )
        seeding_env.monkeypatch.setattr(
            env, "posthog", PostHogConfig(api_key_configured=False)
        )
        seeding_env.monkeypatch.setattr(service, "_development_policy_announced", False)

        await _seed()

        assert seeding_env.vault.row is not None
        (client,) = FakeProxyClient.instances
        (call,) = client.generate_calls
        assert call["max_budget"] == 5.0
        assert call["rpm_limit"] == 30

    @pytest.mark.parametrize("runtime_key", ["", "replace-me"])
    async def test_an_unreadable_deployment_refuses_to_seed(
        self, seeding_env, runtime_key
    ):
        # Without a runtime key the API cannot issue a credential that reads a write-only
        # secret, so a seeded row would be a funded key nothing can spend. Refuse rather
        # than mint into a connection that cannot work.
        seeding_env.monkeypatch.setattr(
            env.agenta, "services_internal_key", runtime_key
        )

        await _seed()

        assert FakeProxyClient.instances == []
        assert seeding_env.vault.row is None
        assert len(seeding_env.alerts) == 1
        assert "AGENTA_SERVICES_INTERNAL_KEY" in seeding_env.alerts[0]

    async def test_the_unreadable_deployment_alert_is_sent_once(self, seeding_env):
        # One alert, not one per signup.
        seeding_env.monkeypatch.setattr(env.agenta, "services_internal_key", "")

        await _seed()
        await _seed()

        assert len(seeding_env.alerts) == 1

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

    async def test_missing_admin_url_disarms(self, seeding_env):
        # Every admin route lives on the internal address; without it a mint
        # would dial a path the proxy does not serve publicly.
        seeding_env.monkeypatch.setattr(
            env, "starter_credits_bridge", _armed_config(proxy_admin_url=None)
        )

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


class TestOneKeyPerOrganization:
    """We mint at most one key per organization; a failed seed is never retried
    by a repair."""

    async def test_alias_conflict_reads_as_already_seeded(self, seeding_env):
        # A key already holds this org's alias (a duplicate signup race, or an
        # earlier seed whose row the user deleted).
        FakeProxyClient.records[ORGANIZATION_ID] = {
            "key_alias": ORGANIZATION_ID,
            "key": "sk-preexisting",
            "max_budget": 10.0,
            "spend": 4.0,
            "metadata": {},
        }

        await _seed()

        # Exactly one mint attempt, no second key, no row, no failure alert.
        assert len(_all_generate_calls()) == 1
        assert FakeProxyClient.records[ORGANIZATION_ID]["key"] == "sk-preexisting"
        assert seeding_env.vault.row is None
        assert seeding_env.alerts == []
        assert seeding_env.released == [ORGANIZATION_EMAIL]

    async def test_concurrent_seeds_produce_one_key_and_one_row(self, seeding_env):
        await asyncio.gather(_seed(), _seed(), return_exceptions=True)

        assert len(FakeProxyClient.records) == 1
        assert seeding_env.vault.created_count == 1
        row = seeding_env.vault.row
        assert row.data.provider.key == FakeProxyClient.records[ORGANIZATION_ID]["key"]

    async def test_failed_seed_is_not_retried_on_the_next_signup_hook(
        self, seeding_env
    ):
        FakeProxyClient.fail_generate(service._MINT_ATTEMPTS)

        await _seed_safely()

        assert seeding_env.vault.row is None
        # The org stays unseeded; nothing in the module converges it later.
        assert not hasattr(service, "reconcile_starter_credits_bridge")


class TestMintRetry:
    async def test_transient_failure_is_retried_within_the_bound(self, seeding_env):
        FakeProxyClient.fail_generate(1, status_code=500)

        await _seed()

        assert len(_all_generate_calls()) == 2
        assert seeding_env.vault.row is not None
        assert seeding_env.alerts == []

    async def test_connection_failure_is_retried(self, seeding_env):
        FakeProxyClient.generate_failures = [
            ProxyRequestError(status_code=None, detail="connection failed")
        ]

        await _seed()

        assert len(_all_generate_calls()) == 2
        assert seeding_env.vault.row is not None

    async def test_retries_are_bounded(self, seeding_env):
        FakeProxyClient.fail_generate(service._MINT_ATTEMPTS)

        await _seed_safely()

        assert len(_all_generate_calls()) == service._MINT_ATTEMPTS
        assert seeding_env.vault.row is None
        assert len(seeding_env.alerts) == 1
        assert "seed_failed" in seeding_env.alerts[0]
        assert seeding_env.released == [ORGANIZATION_EMAIL]

    async def test_client_error_is_never_retried(self, seeding_env):
        FakeProxyClient.fail_generate(1, status_code=400)

        await _seed_safely()

        assert len(_all_generate_calls()) == 1
        assert seeding_env.vault.row is None
        assert len(seeding_env.alerts) == 1

    async def test_alias_conflict_is_never_retried(self, seeding_env):
        FakeProxyClient.generate_failures = [
            KeyAliasExistsError(status_code=400, detail="already exists: alias")
        ]

        await _seed()

        assert len(_all_generate_calls()) == 1
        assert seeding_env.vault.row is None


class TestRowWriteFailure:
    async def test_row_write_failure_blocks_the_orphaned_key(self, seeding_env):
        seeding_env.vault.create_error = RuntimeError("vault write failed")

        await _seed_safely()

        assert seeding_env.vault.row is None
        minted = FakeProxyClient.records[ORGANIZATION_ID]["key"]
        assert _all_block_calls() == [minted]
        assert len(seeding_env.alerts) == 1
        assert "seed_failed" in seeding_env.alerts[0]

    async def test_a_failing_block_still_degrades_quietly(self, seeding_env):
        seeding_env.vault.create_error = RuntimeError("vault write failed")

        async def block_fails(self, *, key):
            raise ProxyRequestError(status_code=500, detail="block failed")

        seeding_env.monkeypatch.setattr(FakeProxyClient, "block_key", block_fails)

        await _seed_safely()

        assert seeding_env.vault.row is None
        assert len(seeding_env.alerts) == 1


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
        # These cases are about a deployment that runs its own PostHog; the
        # development-policy cases below say so explicitly.
        monkeypatch.setattr(env, "posthog", PostHogConfig(api_key_configured=True))
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

    async def test_the_payload_is_the_only_source_of_policy_values(self):
        # No deployment can raise a cap or a grant on its own: the payload is it.
        payload = dict(self._PAYLOAD, grant_usd=7.5)
        self.monkeypatch.setattr(
            service, "_load_posthog", lambda: self._posthog_with(payload)
        )

        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.grant_usd == 7.5
        # The payload's list adds to the built-in defaults rather than replacing them.
        assert policy.is_freemail("freemail.test") is True
        assert policy.is_freemail("gmail.com") is True

    def _unconfigured_posthog(self):
        """A deployment that supplied no PostHog key of its own.

        Driven through the config the bridge actually reads, not by stubbing the
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

        self.monkeypatch.setattr(service, "_load_posthog", _must_not_be_consulted)

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
        self.monkeypatch.setattr(service, "_development_policy_announced", False)

        policy = await service._resolve_mint_policy()

        assert policy is not None
        assert policy.grant_usd == 5.0
        assert policy.global_daily == 1000
        assert policy.key_tpm_limit == 200_000
        assert policy.block_digit_locals is False
        # The built-in domain list still applies through the union.
        assert policy.is_freemail("gmail.com") is True
        # Nothing was cached: the development policy never becomes a stored payload.
        assert self.cache == {}

    async def test_the_development_policy_announces_itself_once(self, caplog):
        self._unconfigured_posthog()
        self.monkeypatch.setattr(service, "_development_policy_announced", False)

        with caplog.at_level("WARNING"):
            await service._resolve_mint_policy()
            await service._resolve_mint_policy()

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
            service, "_load_posthog", lambda: self._posthog_with(None)
        )

        assert await service._resolve_mint_policy() is None

    async def test_a_configured_posthog_that_will_not_load_still_fails_closed(self):
        # Configured, but the client cannot be built: on such a deployment that is a
        # fault to fail closed on, never a reason to grant credits on dev values.
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


class TestManagedAndWriteOnlyRow:
    """The seeded connection is Agenta's from creation: unreadable and undeletable.

    `managed_by` refuses user deletes and re-credentialing; `write_only` keeps the proxy
    virtual key out of every user-facing read. Both ride the CREATE, so the row is never
    briefly readable or removable.
    """

    async def test_the_row_is_created_managed_and_write_only(self, seeding_env):
        await _seed()

        create_dto = seeding_env.vault.create_dto
        assert create_dto is not None
        assert create_dto.managed_by == service.ORIGIN_MARKER
        assert create_dto.write_only is True

        assert seeding_env.vault.row.managed_by == service.ORIGIN_MARKER
        assert seeding_env.vault.row.write_only is True


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
    def armed(self, monkeypatch):
        monkeypatch.setattr(env, "starter_credits_bridge", _armed_config())
        self.engine = FakeCacheEngine()
        monkeypatch.setattr(service, "get_cache_engine", lambda: self.engine)
        self.records: list = []

        class _RecordingLog:
            def __init__(self, records):
                self._records = records

            def warning(self, message, **kwargs):
                self._records.append((message, kwargs))

            def __getattr__(self, _name):
                return lambda *args, **kwargs: None

        monkeypatch.setattr(service, "log", _RecordingLog(self.records))

    async def test_a_digit_local_refusal_names_the_rule_and_the_domain(self):
        assert await service._mint_policy_allows("john99@acme.test", _policy()) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "digit_local_part"
        assert fields["domain"] == "acme.test"
        assert "john99" not in repr((message, fields))

    async def test_a_velocity_refusal_names_the_rule_and_the_domain(self):
        policy = _policy(work_domain_daily=1)

        assert await service._mint_policy_allows("alice@acme.test", policy) is True
        assert await service._mint_policy_allows("bob@acme.test", policy) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "work_domain_daily"
        assert fields["domain"] == "acme.test"
        assert "bob" not in repr((message, fields))

    async def test_an_unverifiable_refusal_names_the_rule_and_the_domain(self):
        self.engine.error = ConnectionError("redis down")

        assert await service._mint_policy_allows("carol@acme.test", _policy()) is False

        message, fields = self.records[-1]
        assert fields["rule"] == "velocity_counters_unavailable"
        assert fields["domain"] == "acme.test"
        assert "carol" not in repr((message, fields))

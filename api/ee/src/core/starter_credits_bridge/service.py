import asyncio
import json
import math
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

import httpx

from oss.src.services import db_manager
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env, StarterCreditsBridgeConfig
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.redis.shared.engine import get_cache_engine
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    CustomModelSettingsDTO,
    CustomProviderDTO,
    CustomProviderSettingsDTO,
    SecretDTO,
    SecretKind,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomProviderKind
from oss.src.core.secrets.managed import (
    SecretManagementDTO,
    SecretManagementPolicy,
    SecretManager,
)
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.shared.dtos import Header

from ee.src.core.starter_credits_bridge.client import StarterCreditsProxyClient
from ee.src.core.starter_credits_bridge.types import (
    DEVELOPMENT_POLICY_VALUES,
    PLUS_ALIAS_ALLOWLIST_DOMAINS,
    KeyAliasExistsError,
    MintedKey,
    MintPolicy,
    ProxyRequestError,
)

log = get_module_logger(__name__)

# Slug of the seeded vault connection; with the project+slug unique index it makes
# the vault write idempotent. NOT proof of ownership: a user can delete and
# recreate the slug, so nothing ownership-sensitive reads it.
STARTER_CREDITS_SLUG = "starter-credits"

# The connection's display name, and therefore the namespace of the stored model
# keys ("<name>/custom/<model>"). It is permanent PER ROW: an organization keeps
# the name and the keys it was seeded with, so changing this renames nothing that
# already exists — it sets what the next organization gets. Changing it after a
# real rollout would leave two namespaces in the field, each correct for its own
# organizations, so treat it as settled once seeding runs anywhere real.
STARTER_CREDITS_NAME = "Agenta"

# Origin carried in the proxy key's metadata (with the org id). Key metadata is
# master-key-only mutable, so it supports later operator-side inspection.
PROXY_ORIGIN = "starter-credits-bridge"

# Human-facing description stored on the connection.
STARTER_CREDITS_DESCRIPTION = "Provided and managed by Agenta."

# The grant invariant: we mint at most one key per organization, guarded by the
# alias (one key per org id on the proxy) and by the slug's unique index in the
# vault. A failed seed is never retried by a repair — the organization simply
# stays unseeded and meets the connect-your-key wall as before.
_SEED_TIMEOUT_SECONDS = 10.0

# The mint is the one call worth retrying inside the seeding bound: a dropped
# connection or a proxy restart is common enough to cost real signups, and a
# retry cannot double-grant (the alias conflict below stops the second key).
_MINT_ATTEMPTS = 3
_MINT_RETRY_BACKOFF_SECONDS = 0.2

_VELOCITY_COUNTER_TTL_SECONDS = 2 * 24 * 3600

# Re-verify the team ceiling after this long, so removing or loosening the
# ceiling is caught without a process restart.
_TEAM_VERIFY_TTL_SECONDS = 600.0

_verified_teams: dict[str, float] = {}

# asyncio only weak-refs scheduled tasks; hold strong refs until each finishes.
_background_tasks: set[asyncio.Task] = set()


async def seed_starter_credits_bridge_safely(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Bounded, swallow-all wrapper for the signup hook: a seeding failure or a
    slow dependency degrades to "no starter credits", never to a broken signup
    (the signup path deletes the new user when setup raises). The alert is
    fire-and-forget so it cannot extend the bound."""
    try:
        async with asyncio.timeout(_SEED_TIMEOUT_SECONDS):
            await seed_starter_credits_bridge(
                organization_id=organization_id,
                organization_email=organization_email,
            )
    except Exception:
        log.warning(
            "[starter_credits_bridge] seed_failed; organization stays unseeded",
            organization_id=organization_id,
            exc_info=True,
        )
        _send_alert_background(
            f"starter-credits-bridge: seed_failed for organization {organization_id}; "
            "it stays unseeded"
        )


async def seed_starter_credits_bridge(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Mint a budget-capped virtual key and seed it into the org's default-project
    vault as a ready-to-use provider connection."""
    config = env.starter_credits_bridge
    # Two kill switches, both program-wide: AGENTA_STARTER_CREDITS_BRIDGE_ENABLED
    # (needs a redeploy) and the PostHog policy payload below — emptying or deleting
    # it leaves the policy unresolved and stops seeding without one. `armed` also
    # requires both proxy addresses (public for the seeded row, admin for minting).
    if not config.armed:
        return

    policy = await _resolve_mint_policy()
    if policy is None:
        return

    client = _proxy_client(config)
    if not await _team_ceiling_verified(client, config):
        return

    project = await db_manager.get_default_project_by_organization_id(organization_id)
    if project is None:
        log.warning(
            "[starter_credits_bridge] no default project; skipping seed",
            organization_id=organization_id,
        )
        return

    vault_service = _vault_service()
    row = await vault_service.get_secret_by_slug(
        STARTER_CREDITS_SLUG,
        project_id=project.id,
    )
    if row is not None:
        return

    if not await _mint_policy_allows(organization_email, policy):
        return

    seeded = False
    try:
        seeded = await _provision(
            client=client,
            config=config,
            policy=policy,
            vault_service=vault_service,
            project_id=project.id,
            organization_id=organization_id,
        )
    finally:
        if not seeded:
            # The consumed velocity slot funded no mint; hand it back best-effort.
            await _release_velocity_slots(organization_email, policy)


async def _provision(
    *,
    client: StarterCreditsProxyClient,
    config: StarterCreditsBridgeConfig,
    policy: MintPolicy,
    vault_service: VaultService,
    project_id: UUID,
    organization_id: str,
) -> bool:
    try:
        minted = await _mint_key(
            client=client,
            config=config,
            policy=policy,
            organization_id=organization_id,
        )
    except KeyAliasExistsError:
        # One alias per organization, so a conflict means this org already holds
        # its key (a duplicate signup race). Never re-mint.
        log.info(
            "[starter_credits_bridge] alias already minted; organization is seeded",
            organization_id=organization_id,
        )
        return False

    try:
        row = await _create_row(
            vault_service=vault_service,
            project_id=project_id,
            config=config,
            virtual_key=minted.key,
        )
    except Exception:
        # The key is live but nothing references it; block it so an orphaned
        # grant can never be spent.
        await _block_key(client, minted.key)
        raise

    log.info(
        "[starter_credits_bridge] seeded starter credits",
        organization_id=organization_id,
        project_id=str(project_id),
        secret_id=str(row.id),
    )
    return True


async def _mint_key(
    *,
    client: StarterCreditsProxyClient,
    config: StarterCreditsBridgeConfig,
    policy: MintPolicy,
    organization_id: str,
) -> MintedKey:
    """Mint the org's one key, retrying only transport failures and proxy 5xx.
    A 4xx is the proxy's verdict on this request (an alias conflict, a rejected
    body) and repeating it can only waste the seeding bound."""
    for attempt in range(_MINT_ATTEMPTS):
        try:
            # The proxy caps what a key may ask for (`upperbound_key_generate_params`:
            # max_budget 5, max_parallel_requests 2, rpm 30, tpm 200000, duration 90d)
            # and fills an OMITTED duration with its cap, so every funded key expires
            # after 90 days. Send no duration rather than a longer one. Raising
            # `grant_usd` or a per-key limit in the policy payload ABOVE a cap makes
            # every mint fail with HTTP 400 until the proxy config is bumped and
            # redeployed; lowering a value is a live payload edit.
            return await client.generate_key(
                key_alias=organization_id,
                max_budget=policy.grant_usd,
                models=[config.model_id],
                metadata={
                    "organization_id": organization_id,
                    "origin": PROXY_ORIGIN,
                },
                team_id=config.team_id,
                max_parallel_requests=policy.key_max_parallel_requests,
                rpm_limit=policy.key_rpm_limit,
                tpm_limit=policy.key_tpm_limit,
            )
        except ProxyRequestError as exc:
            if not _is_transient(exc) or attempt == _MINT_ATTEMPTS - 1:
                raise
            log.warning(
                "[starter_credits_bridge] transient mint failure; retrying",
                organization_id=organization_id,
                attempt=attempt + 1,
                status_code=exc.status_code,
            )
            await asyncio.sleep(_MINT_RETRY_BACKOFF_SECONDS * (2**attempt))

    raise ProxyRequestError(status_code=None, detail="mint retries exhausted")


def _is_transient(error: ProxyRequestError) -> bool:
    return error.status_code is None or error.status_code >= 500


async def _block_key(client: StarterCreditsProxyClient, key: str) -> None:
    """Best-effort block; a failed block leaves a key nothing can reach through
    the product, still bounded by its own budget and the team ceiling."""
    try:
        await client.block_key(key=key)
    except Exception:
        log.warning(
            "[starter_credits_bridge] could not block the orphaned key",
            exc_info=True,
        )


async def _create_row(
    *,
    vault_service: VaultService,
    project_id: UUID,
    config: StarterCreditsBridgeConfig,
    virtual_key: str,
) -> SecretResponseDTO:
    data = CustomProviderDTO(
        kind=CustomProviderKind.CUSTOM,
        provider=CustomProviderSettingsDTO(
            # The PUBLIC address: this is what a run dials, and a sandboxed run
            # is outside the proxy's network.
            url=config.proxy_public_url,
            key=virtual_key,
        ),
        models=[CustomModelSettingsDTO(slug=config.model_id)],
        harnesses=["pi_core"],
        # The namespace half of every model key this connection publishes
        # (`<provider_slug>/<kind>/<model>`), and it must equal the display name:
        # that is the namespace the resolver rebuilds keys under, and a model key is
        # permanent once a config references it. `CreateSecretDTO` fills this in from
        # the header only when the payload arrives as plain dicts, which is not how
        # this call builds it, so it is set here explicitly.
        provider_slug=STARTER_CREDITS_NAME,
    ).model_dump()

    return await vault_service.create_managed_secret(
        project_id=project_id,
        create_secret_dto=CreateSecretDTO(
            slug=STARTER_CREDITS_SLUG,
            header=Header(
                name=STARTER_CREDITS_NAME,
                description=STARTER_CREDITS_DESCRIPTION,
            ),
            secret=SecretDTO(
                kind=SecretKind.CUSTOM_PROVIDER,
                data=data,
            ),
            write_only=True,
        ),
        management=SecretManagementDTO(
            manager=SecretManager.STARTER_CREDITS_BRIDGE,
            policy=SecretManagementPolicy.MANAGER_ONLY,
        ),
    )


# --- gates -----------------------------------------------------------------


def _proxy_client(config: StarterCreditsBridgeConfig) -> StarterCreditsProxyClient:
    # The ADMIN address, never the public one: the proxy publishes only its
    # inference paths publicly, so /key/generate, /key/block and /team/info are
    # reachable on the internal network alone.
    return StarterCreditsProxyClient(
        base_url=config.proxy_admin_url,
        master_key=config.master_key,
    )


def _vault_service() -> VaultService:
    return VaultService(SecretsDAO())


async def _team_ceiling_verified(
    client: StarterCreditsProxyClient,
    config: StarterCreditsBridgeConfig,
) -> bool:
    """Refuse to mint unless the program team stands with a numeric, finite,
    non-resetting budget ceiling — the always-on bound on total exposure. Fail
    closed; a positive result is trusted only for a short TTL so a removed or
    loosened ceiling is caught without a restart."""
    team_id = config.team_id
    verified_at = _verified_teams.get(team_id)
    if (
        verified_at is not None
        and _monotonic() - verified_at < _TEAM_VERIFY_TTL_SECONDS
    ):
        return True

    try:
        payload = await client.get_team_info(team_id=team_id)
    except Exception as exc:
        log.error(
            "[starter_credits_bridge] team ceiling unverifiable; refusing to seed",
            team_id=team_id,
            reason=str(exc),
        )
        _send_alert_background(
            f"starter-credits-bridge: team '{team_id}' unverifiable; seeding refused"
        )
        return False

    team_info = payload.get("team_info") or payload
    max_budget = team_info.get("max_budget")
    budget_duration = team_info.get("budget_duration")

    if (
        not isinstance(max_budget, (int, float))
        or isinstance(max_budget, bool)
        or not _is_finite_positive(max_budget)
    ):
        log.error(
            "[starter_credits_bridge] team has no sound max_budget; refusing to seed",
            team_id=team_id,
        )
        _send_alert_background(
            f"starter-credits-bridge: team '{team_id}' has no budget ceiling; seeding refused"
        )
        return False

    if budget_duration:
        # A duration makes the ceiling reset periodically — that is a rate, not
        # the program's total-exposure bound.
        log.error(
            "[starter_credits_bridge] team budget resets; refusing to seed",
            team_id=team_id,
            budget_duration=budget_duration,
        )
        _send_alert_background(
            f"starter-credits-bridge: team '{team_id}' budget resets "
            f"(duration {budget_duration}); seeding refused"
        )
        return False

    _verified_teams[team_id] = _monotonic()
    return True


def _is_finite_positive(value: float) -> bool:
    return math.isfinite(value) and value > 0


def _monotonic() -> float:
    return time.monotonic()


# The development-policy notice is worth seeing, and worth seeing once: it would
# otherwise repeat on every signup for the whole life of a dev process.
_development_policy_announced = False


def _development_policy() -> MintPolicy:
    """The policy a deployment without PostHog runs on. Values live in `types.py`."""
    global _development_policy_announced

    if not _development_policy_announced:
        _development_policy_announced = True
        log.warning(
            "starter credits: PostHog not configured, using the built-in development policy"
        )

    return MintPolicy(**DEVELOPMENT_POLICY_VALUES)


async def _resolve_mint_policy() -> Optional[MintPolicy]:
    """Resolve the mint policy. Live-first; a MALFORMED live payload fails
    closed with an alert (a bad rollout must never silently keep old caps via
    the cache) — only a transport failure may fall back to the Redis-cached
    payload. The payload is the only source of policy values, except on a
    deployment that configured no PostHog of its own, which runs on the built-in
    development policy. No resolvable policy means no seeding."""
    flag = env.starter_credits_bridge.policy_flag
    # Deliberately global: the mint policy is one program-wide payload (caps, domain
    # rules), identical for every organization.
    cache_key = {"ff": flag}

    # Deliberately NOT `env.posthog.enabled`: the PostHog config falls back to a
    # built-in project key, so `enabled` is true in every checkout and could never
    # tell a local stack from a deployment that runs its own PostHog. A deployment
    # that supplied no key of its own has no way to publish a policy, so failing
    # closed would simply block it; one that did keeps failing closed below on a
    # missing or malformed payload, which is what protects production.
    if not env.posthog.api_key_configured:
        return _development_policy()

    payload: Optional[dict] = None
    live_malformed = False
    posthog = _load_posthog()
    if posthog is not None:
        try:
            raw = await asyncio.to_thread(
                posthog.get_feature_flag_payload, flag, "starter-credits-bridge"
            )
        except Exception as exc:
            log.warning(
                "[starter_credits_bridge] live policy lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            if raw is None:
                # A reachable PostHog with no payload is a real "no policy" signal:
                # nothing else can supply one, so the resolve below fails closed.
                payload = None
            else:
                payload = _parse_policy_payload(raw)
                if payload is None:
                    live_malformed = True

    if payload is None and not live_malformed:
        cached = await get_cache(
            namespace="starter_credits_bridge:policy",
            key=cache_key,
            retry=False,
        )
        if isinstance(cached, dict):
            payload = cached

    try:
        policy = MintPolicy(**({} if live_malformed else (payload or {})))
    except Exception:
        log.error(
            "[starter_credits_bridge] mint policy missing or invalid; seeding disabled (fail closed)",
            malformed_live_payload=live_malformed,
        )
        if live_malformed:
            _send_alert_background(
                "starter-credits-bridge: live policy payload is malformed; seeding disabled"
            )
        return None

    if payload is not None and not live_malformed:
        await set_cache(
            namespace="starter_credits_bridge:policy",
            key=cache_key,
            value=payload,
        )
    return policy


def _parse_policy_payload(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _velocity_counters(
    organization_email: str,
    policy: MintPolicy,
) -> list[tuple[str, int, int, str]]:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    domain = _email_domain(organization_email)

    counters = [
        (
            f"starter_credits_bridge:mints:{day}",
            policy.global_daily,
            _VELOCITY_COUNTER_TTL_SECONDS,
            "global_daily",
        ),
        (
            f"starter_credits_bridge:mints:hour:{hour}",
            policy.global_hourly,
            2 * 3600,
            "global_hourly",
        ),
    ]
    if not policy.is_freemail(domain):
        counters.append(
            (
                f"starter_credits_bridge:mints:{day}:domain:{domain}",
                policy.work_domain_daily,
                _VELOCITY_COUNTER_TTL_SECONDS,
                "work_domain_daily",
            )
        )
    return counters


def _email_domain(organization_email: str) -> str:
    _, _, domain = organization_email.rpartition("@")
    return domain.lower() or "unknown"


async def _mint_policy_allows(
    organization_email: str,
    policy: MintPolicy,
) -> bool:
    """Apply the mint policy: eligibility rules, then Redis counters (global
    daily + hourly; per-domain daily on non-free-mail domains only). Fail closed
    on Redis errors: an unverifiable mint is a skipped mint."""
    local_part, _, _ = organization_email.rpartition("@")
    domain = _email_domain(organization_email)
    freemail = policy.is_freemail(domain)

    if "+" in local_part and domain not in PLUS_ALIAS_ALLOWLIST_DOMAINS:
        log.warning(
            "[starter_credits_bridge] policy refused mint; skipping seed",
            rule="plus_local_part",
            domain=domain,
        )
        return False

    if (
        not freemail
        and domain not in PLUS_ALIAS_ALLOWLIST_DOMAINS
        and policy.block_digit_locals
        and any(character.isdigit() for character in local_part)
    ):
        log.warning(
            "[starter_credits_bridge] policy refused mint; skipping seed",
            rule="digit_local_part",
            # The domain, never the address: it is what makes a refusal diagnosable
            # (which provider, which rule) without logging who signed up.
            domain=domain,
        )
        return False

    engine = get_cache_engine()
    try:
        for counter_key, cap, ttl, scope in _velocity_counters(
            organization_email, policy
        ):
            count = await engine.incr(counter_key)
            if count == 1:
                await engine.expire(counter_key, ttl)
            if count > cap:
                log.warning(
                    "[starter_credits_bridge] velocity cap reached; skipping seed",
                    rule=scope,
                    domain=domain,
                )
                return False
    except Exception as exc:
        log.warning(
            "[starter_credits_bridge] velocity counters unavailable; skipping seed (fail closed)",
            rule="velocity_counters_unavailable",
            domain=domain,
            reason=str(exc),
        )
        return False

    return True


async def _release_velocity_slots(
    organization_email: str,
    policy: MintPolicy,
) -> None:
    """Best-effort: hand consumed counter slots back when the attempt funded no
    mint, so an outage does not eat the day's allowance."""
    engine = get_cache_engine()
    for counter_key, _cap, _ttl, _scope in _velocity_counters(
        organization_email, policy
    ):
        try:
            await engine.decr(counter_key)
        except Exception:
            return


def _send_alert_background(text: str) -> None:
    """Schedule the operator alert without blocking the caller; never raises."""
    try:
        task = asyncio.create_task(_send_alert(text))
        task.add_done_callback(_background_tasks.discard)
        _background_tasks.add(task)
    except Exception:
        log.warning("[starter_credits_bridge] could not schedule alert", exc_info=True)


async def _send_alert(text: str) -> None:
    """Best-effort operator alert; failures only log."""
    webhook = env.starter_credits_bridge.alert_webhook
    if not webhook:
        return

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(webhook, json={"text": text})
            response.raise_for_status()
    except Exception:
        log.warning(
            "[starter_credits_bridge] alert webhook failed",
            exc_info=True,
        )

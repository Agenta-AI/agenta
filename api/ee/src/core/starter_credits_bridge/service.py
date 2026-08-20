import asyncio
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

import httpx

from oss.src.services import db_manager
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
from oss.src.utils.env import env
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
)
from oss.src.core.secrets.enums import CustomProviderKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.shared.dtos import Header

from ee.src.core.starter_credits_bridge.client import StarterCreditsProxyClient
from ee.src.core.starter_credits_bridge.types import KeyAliasExistsError

log = get_module_logger(__name__)

# Slug of the seeded vault connection; with the project+slug unique index it makes
# the vault write idempotent. NOT proof of ownership: a user can delete and
# recreate the slug, so teardown/reconciliation match by ORIGIN_MARKER + exact
# secret id, never by slug alone.
STARTER_CREDITS_SLUG = "starter-credits"

# The connection's display name. It is ALSO the namespace of the stored model keys
# ("<name>/custom/<model>"), so once orgs are seeded it is a permanent contract:
# renaming it would orphan every seeded org's model selector.
STARTER_CREDITS_NAME = "Starter credits"

# Ownership marker carried in the proxy key's metadata (with the org id and the
# exact vault secret id) and mirrored in the vault row's header.description.
ORIGIN_MARKER = "starter-credits-bridge"

# Upper bound on the inline seeding work inside the signup path.
_SEED_TIMEOUT_SECONDS = 10.0

_VELOCITY_COUNTER_TTL_SECONDS = 2 * 24 * 3600

# Process-lifetime cache of team ids whose budget ceiling verified as sound.
_verified_team_ids: set[str] = set()


async def seed_starter_credits_bridge_safely(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Bounded, swallow-all wrapper for the signup hook: a seeding failure or a
    slow proxy degrades to "no starter credits", never to a broken signup (the
    signup path deletes the new user when setup raises)."""
    try:
        async with asyncio.timeout(_SEED_TIMEOUT_SECONDS):
            await seed_starter_credits_bridge(
                organization_id=organization_id,
                organization_email=organization_email,
            )
    except Exception:
        log.warning(
            "[starter_credits_bridge] seeding failed; organization stays unseeded",
            organization_id=organization_id,
            exc_info=True,
        )
        await _send_alert(
            f"starter-credits-bridge: seeding failed for organization {organization_id}; "
            "it stays unseeded (reconcile to repair)"
        )


async def seed_starter_credits_bridge(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Mint a budget-capped virtual key and seed it into the org's default-project
    vault as a ready-to-use provider connection. Re-entrant: every partial state
    (orphaned key, missing vault row) converges on the next call."""
    config = env.starter_credits_bridge
    if not config.armed:
        return

    if not await _feature_flag_enabled(organization_id):
        log.info(
            "[starter_credits_bridge] feature flag off; skipping seed",
            organization_id=organization_id,
        )
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
    existing = await vault_service.get_secret_by_slug(
        STARTER_CREDITS_SLUG,
        project_id=project.id,
    )
    if existing is not None:
        return

    if not await _within_velocity_limits(organization_email):
        return

    await _mint_and_seed(
        client=client,
        config=config,
        vault_service=vault_service,
        project_id=project.id,
        organization_id=organization_id,
    )


async def reconcile_starter_credits_bridge(*, organization_id: str) -> str:
    """Repair partial seed states for one organization; returns the outcome.

    States and repairs: key-without-row (orphan) -> delete the orphan and re-mint
    (the raw key value is unrecoverable by design); row-without-key -> replace the
    row, but ONLY when it carries our ownership marker; both present -> no-op.
    Velocity caps do not apply: this converges already-approved seeds, it never
    grants new ones a signup would not have gotten.
    """
    config = env.starter_credits_bridge
    if not config.armed:
        return "disabled"

    if not await _feature_flag_enabled(organization_id):
        return "flag_off"

    client = _proxy_client(config)
    if not await _team_ceiling_verified(client, config):
        return "team_unverified"

    project = await db_manager.get_default_project_by_organization_id(organization_id)
    if project is None:
        return "no_default_project"

    vault_service = _vault_service()
    row = await vault_service.get_secret_by_slug(
        STARTER_CREDITS_SLUG,
        project_id=project.id,
    )
    keys = await client.list_keys(key_alias=organization_id)
    our_keys = [
        key
        for key in keys
        if (key.get("metadata") or {}).get("origin") == ORIGIN_MARKER
    ]

    if row is not None and our_keys:
        return "healthy"

    if row is None:
        await _mint_and_seed(
            client=client,
            config=config,
            vault_service=vault_service,
            project_id=project.id,
            organization_id=organization_id,
        )
        return "reseeded" if our_keys or keys else "seeded"

    # Row without a key: replace it only when it is provably ours.
    if _row_origin(row) != ORIGIN_MARKER:
        log.warning(
            "[starter_credits_bridge] slug row without our marker; leaving it alone",
            organization_id=organization_id,
        )
        return "foreign_row"

    await vault_service.delete_secret(secret_id=row.id, project_id=project.id)
    await invalidate_cache(project_id=str(project.id))
    await _mint_and_seed(
        client=client,
        config=config,
        vault_service=vault_service,
        project_id=project.id,
        organization_id=organization_id,
    )
    return "reseeded"


async def _mint_and_seed(
    *,
    client: StarterCreditsProxyClient,
    config: Any,
    vault_service: VaultService,
    project_id: UUID,
    organization_id: str,
) -> None:
    metadata = {"organization_id": organization_id, "origin": ORIGIN_MARKER}

    async def _mint():
        return await client.generate_key(
            key_alias=organization_id,
            max_budget=config.grant_usd,
            models=[config.model_id],
            metadata=metadata,
            team_id=config.team_id,
        )

    try:
        minted = await _mint()
    except KeyAliasExistsError:
        # Orphaned key from a partial earlier run (no vault row). The raw key value
        # is unrecoverable by design, so delete-and-remint is the compensation that
        # makes re-entry converge instead of give up.
        log.warning(
            "[starter_credits_bridge] deleting orphaned key and re-minting",
            organization_id=organization_id,
        )
        await client.delete_keys(key_aliases=[organization_id])
        minted = await _mint()

    created = await vault_service.create_secret(
        project_id=project_id,
        create_secret_dto=_build_secret_dto(config=config, virtual_key=minted.key),
    )
    await invalidate_cache(project_id=str(project_id))

    try:
        await client.update_key(
            key=minted.key,
            metadata={**metadata, "secret_id": str(created.id)},
        )
    except Exception:
        # Non-fatal: reconciliation and teardown still match by origin + org id.
        log.warning(
            "[starter_credits_bridge] could not record secret_id on the key",
            organization_id=organization_id,
            exc_info=True,
        )

    log.info(
        "[starter_credits_bridge] seeded starter credits",
        organization_id=organization_id,
        project_id=str(project_id),
        secret_id=str(created.id),
    )


def _build_secret_dto(*, config: Any, virtual_key: str) -> CreateSecretDTO:
    return CreateSecretDTO(
        slug=STARTER_CREDITS_SLUG,
        header=Header(name=STARTER_CREDITS_NAME, description=ORIGIN_MARKER),
        secret=SecretDTO(
            kind=SecretKind.CUSTOM_PROVIDER,
            data=CustomProviderDTO(
                kind=CustomProviderKind.CUSTOM,
                provider=CustomProviderSettingsDTO(
                    url=config.proxy_public_url,
                    key=virtual_key,
                ),
                models=[CustomModelSettingsDTO(slug=config.model_id)],
            ),
        ),
    )


def _row_origin(row: Any) -> Optional[str]:
    header = getattr(row, "header", None)
    return getattr(header, "description", None)


def _proxy_client(config: Any) -> StarterCreditsProxyClient:
    return StarterCreditsProxyClient(
        base_url=config.proxy_public_url,
        master_key=config.master_key,
    )


def _vault_service() -> VaultService:
    return VaultService(SecretsDAO())


async def _team_ceiling_verified(
    client: StarterCreditsProxyClient,
    config: Any,
) -> bool:
    """Refuse to mint unless the program team stands with a numeric, non-resetting
    budget ceiling — the always-on bound on total exposure. Fail closed; positive
    results are cached for the process lifetime."""
    team_id = config.team_id
    if team_id in _verified_team_ids:
        return True

    try:
        payload = await client.get_team_info(team_id=team_id)
    except Exception as exc:
        log.error(
            "[starter_credits_bridge] team ceiling unverifiable; refusing to seed",
            team_id=team_id,
            reason=str(exc),
        )
        await _send_alert(
            f"starter-credits-bridge: team '{team_id}' unverifiable; seeding refused"
        )
        return False

    team_info = payload.get("team_info") or payload
    max_budget = team_info.get("max_budget")
    budget_duration = team_info.get("budget_duration")

    if not isinstance(max_budget, (int, float)) or isinstance(max_budget, bool):
        log.error(
            "[starter_credits_bridge] team has no numeric max_budget; refusing to seed",
            team_id=team_id,
        )
        await _send_alert(
            f"starter-credits-bridge: team '{team_id}' has no budget ceiling; seeding refused"
        )
        return False

    if budget_duration:
        # A duration makes the ceiling reset periodically — that is a rate, not the
        # program's total-exposure bound.
        log.error(
            "[starter_credits_bridge] team budget resets; refusing to seed",
            team_id=team_id,
            budget_duration=budget_duration,
        )
        await _send_alert(
            f"starter-credits-bridge: team '{team_id}' budget resets "
            f"(duration {budget_duration}); seeding refused"
        )
        return False

    _verified_team_ids.add(team_id)
    return True


async def _feature_flag_enabled(organization_id: str) -> bool:
    """Evaluate the PostHog kill switch, live-first so a flip takes effect on the
    next signup. Fail closed: on a PostHog outage the last Redis-cached value
    stands in; with no cached value either, no seeding."""
    flag = env.starter_credits_bridge.feature_flag

    posthog = _load_posthog()
    if posthog is not None:
        try:
            # The org id as distinct id keeps evaluation deterministic per org and
            # lets PostHog percentage rollouts partition signups without a code change.
            result = posthog.feature_enabled(flag, organization_id)
        except Exception as exc:
            log.warning(
                "[starter_credits_bridge] live feature flag lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            enabled = result is True
            await set_cache(
                namespace="starter_credits_bridge:flag",
                key={"ff": flag},
                value=enabled,
            )
            return enabled

    cached = await get_cache(
        namespace="starter_credits_bridge:flag",
        key={"ff": flag},
        retry=False,
    )
    if cached is not None:
        return bool(cached)

    log.warning(
        "[starter_credits_bridge] no feature flag signal; seeding disabled (fail closed)",
    )
    return False


async def _within_velocity_limits(organization_email: str) -> bool:
    """Bound mints per day globally and per email domain. Fail closed on Redis
    errors: an unverifiable mint on the money path is a skipped mint."""
    config = env.starter_credits_bridge
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    domain = (
        organization_email.rsplit("@", 1)[1].lower()
        if "@" in organization_email
        else "unknown"
    )

    counters = (
        (f"starter_credits_bridge:mints:{day}", config.daily_mint_cap, "global"),
        (
            f"starter_credits_bridge:mints:{day}:domain:{domain}",
            config.domain_daily_mint_cap,
            "domain",
        ),
    )

    engine = get_cache_engine()
    try:
        for counter_key, cap, scope in counters:
            count = await engine.incr(counter_key)
            if count == 1:
                await engine.expire(counter_key, _VELOCITY_COUNTER_TTL_SECONDS)
            if count > cap:
                log.warning(
                    "[starter_credits_bridge] velocity cap reached; skipping seed",
                    scope=scope,
                    cap=cap,
                )
                return False
    except Exception as exc:
        log.warning(
            "[starter_credits_bridge] velocity counters unavailable; skipping seed (fail closed)",
            reason=str(exc),
        )
        return False

    return True


async def _send_alert(text: str) -> None:
    """Best-effort operator alert; failures only log."""
    webhook = env.starter_credits_bridge.alert_webhook
    if not webhook:
        return

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(webhook, json={"text": text})
    except Exception:
        log.warning(
            "[starter_credits_bridge] alert webhook failed",
            exc_info=True,
        )

import asyncio
from datetime import datetime, timezone

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

from ee.src.core.funded_credits.client import FundedCreditsProxyClient
from ee.src.core.funded_credits.types import KeyAliasExistsError

log = get_module_logger(__name__)

# Slug of the seeded vault connection; with the project+slug unique index it makes
# the vault write idempotent, and teardown/backfill scripts find seeds by it.
STARTER_CREDITS_SLUG = "starter-credits"

# The connection's display name. It is ALSO the namespace of the stored model keys
# ("<name>/custom/<model>"), so once orgs are seeded it is a permanent contract:
# renaming it would orphan every seeded org's model selector.
STARTER_CREDITS_NAME = "Starter credits"

_VELOCITY_COUNTER_TTL_SECONDS = 2 * 24 * 3600

# asyncio only weak-refs scheduled tasks; hold strong refs until each one finishes.
_background_tasks: set[asyncio.Task] = set()


def schedule_funded_credits_seeding(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Kick off seeding in the background. Never raises, never blocks signup."""
    if not env.funded_credits.armed:
        return

    try:
        task = asyncio.create_task(
            seed_funded_credits_safely(
                organization_id=organization_id,
                organization_email=organization_email,
            )
        )
        task.add_done_callback(_background_tasks.discard)
        _background_tasks.add(task)
    except Exception:
        log.warning(
            "[funded_credits] could not schedule seeding",
            organization_id=organization_id,
            exc_info=True,
        )


async def seed_funded_credits_safely(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Swallow-all wrapper: a seeding failure degrades to "no seed", never breaks
    signup (the signup path deletes the new user when setup raises)."""
    try:
        await seed_funded_credits(
            organization_id=organization_id,
            organization_email=organization_email,
        )
    except Exception:
        log.warning(
            "[funded_credits] seeding failed; organization stays unfunded",
            organization_id=organization_id,
            exc_info=True,
        )


async def seed_funded_credits(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Mint a budget-capped virtual key and seed it into the org's default-project
    vault as a ready-to-use provider connection."""
    config = env.funded_credits
    if not config.armed:
        return

    if not await _feature_flag_enabled(organization_id):
        log.info(
            "[funded_credits] feature flag off; skipping seed",
            organization_id=organization_id,
        )
        return

    project = await db_manager.get_default_project_by_organization_id(organization_id)
    if project is None:
        log.warning(
            "[funded_credits] no default project; skipping seed",
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

    client = FundedCreditsProxyClient(
        base_url=config.proxy_url,
        master_key=config.master_key,
    )
    try:
        minted = await client.generate_key(
            key_alias=organization_id,
            max_budget=config.grant_usd,
            models=[config.model],
            metadata={"organization_id": organization_id},
            team_id=config.team_id,
            rpm_limit=config.rpm_limit,
            tpm_limit=config.tpm_limit,
        )
    except KeyAliasExistsError:
        # A key exists but the vault seed is missing (earlier partial failure). The
        # raw key is unrecoverable from the proxy; a re-seed sweep handles these.
        log.warning(
            "[funded_credits] key already minted but not seeded; skipping",
            organization_id=organization_id,
        )
        return

    create_secret_dto = CreateSecretDTO(
        slug=STARTER_CREDITS_SLUG,
        header=Header(name=STARTER_CREDITS_NAME),
        secret=SecretDTO(
            kind=SecretKind.CUSTOM_PROVIDER,
            data=CustomProviderDTO(
                kind=CustomProviderKind.CUSTOM,
                provider=CustomProviderSettingsDTO(
                    url=config.connection_url or config.proxy_url,
                    key=minted.key,
                ),
                models=[CustomModelSettingsDTO(slug=config.model)],
            ),
        ),
    )
    await vault_service.create_secret(
        project_id=project.id,
        create_secret_dto=create_secret_dto,
    )
    await invalidate_cache(project_id=str(project.id))

    log.info(
        "[funded_credits] seeded starter credits",
        organization_id=organization_id,
        project_id=str(project.id),
    )


def _vault_service() -> VaultService:
    return VaultService(SecretsDAO())


async def _feature_flag_enabled(organization_id: str) -> bool:
    """Evaluate the PostHog kill switch, live-first so a flip takes effect on the
    next signup. Fail closed: on a PostHog outage the last Redis-cached value
    stands in; with no cached value either, no seeding."""
    flag = env.funded_credits.feature_flag

    posthog = _load_posthog()
    if posthog is not None:
        try:
            # The org id as distinct id keeps evaluation deterministic per org and
            # lets PostHog percentage rollouts partition signups without a code change.
            result = posthog.feature_enabled(flag, organization_id)
        except Exception as exc:
            log.warning(
                "[funded_credits] live feature flag lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            enabled = result is True
            await set_cache(
                namespace="funded_credits:flag",
                key={"ff": flag},
                value=enabled,
            )
            return enabled

    cached = await get_cache(
        namespace="funded_credits:flag",
        key={"ff": flag},
        retry=False,
    )
    if cached is not None:
        return bool(cached)

    log.warning(
        "[funded_credits] no feature flag signal; seeding disabled (fail closed)",
    )
    return False


async def _within_velocity_limits(organization_email: str) -> bool:
    """Bound mints per day globally and per email domain. Fail closed on Redis
    errors: an unverifiable mint on the money path is a skipped mint."""
    config = env.funded_credits
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    domain = (
        organization_email.rsplit("@", 1)[1].lower()
        if "@" in organization_email
        else "unknown"
    )

    counters = (
        (f"funded_credits:mints:{day}", config.daily_mint_cap, "global"),
        (
            f"funded_credits:mints:{day}:domain:{domain}",
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
                    "[funded_credits] velocity cap reached; skipping seed",
                    scope=scope,
                    cap=cap,
                )
                return False
    except Exception as exc:
        log.warning(
            "[funded_credits] velocity counters unavailable; skipping seed (fail closed)",
            reason=str(exc),
        )
        return False

    return True

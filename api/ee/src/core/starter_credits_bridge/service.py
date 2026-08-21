import asyncio
import json
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
from ee.src.core.starter_credits_bridge.types import KeyAliasExistsError, MintPolicy

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

    if not await _mint_policy_allows(organization_email):
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
    at its REMAINING budget (the raw key value is unrecoverable by design; an
    exhausted orphan is blocked, not replaced); row-without-key -> replace the
    row, but ONLY when it carries our ownership marker; both present -> no-op.
    Velocity caps do not apply: this converges already-approved seeds, it never
    grants new ones a signup would not have gotten. Manual and operator-run only
    (there is deliberately no automatic sweep), under one invariant: a reconcile
    never increases an organization's total lifetime grant.
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
        outcome = await _mint_and_seed(
            client=client,
            config=config,
            vault_service=vault_service,
            project_id=project.id,
            organization_id=organization_id,
        )
        if outcome != "seeded":
            return outcome
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
    outcome = await _mint_and_seed(
        client=client,
        config=config,
        vault_service=vault_service,
        project_id=project.id,
        organization_id=organization_id,
    )
    return "reseeded" if outcome == "seeded" else outcome


async def _mint_and_seed(
    *,
    client: StarterCreditsProxyClient,
    config: Any,
    vault_service: VaultService,
    project_id: UUID,
    organization_id: str,
) -> str:
    metadata = {"organization_id": organization_id, "origin": ORIGIN_MARKER}

    async def _mint(max_budget: float):
        return await client.generate_key(
            key_alias=organization_id,
            max_budget=max_budget,
            models=[config.model_id],
            metadata=metadata,
            team_id=config.team_id,
            max_parallel_requests=config.key_max_parallel_requests,
            rpm_limit=config.key_rpm_limit,
            tpm_limit=config.key_tpm_limit,
        )

    try:
        minted = await _mint(config.grant_usd)
    except KeyAliasExistsError:
        # Orphaned key from a partial earlier run (no vault row) — a state a user
        # can also create by deleting their vault connection. The raw key value is
        # unrecoverable by design, so the compensation is delete-and-remint, but
        # ONLY at the orphan's remaining budget: a reconcile never increases an
        # organization's total lifetime grant, or "spend, delete the connection,
        # get reseeded" becomes a refill exploit.
        remaining = await _orphan_remaining_budget(client, organization_id)
        if remaining is None:
            log.error(
                "[starter_credits_bridge] orphaned key budget unreadable; refusing to re-mint",
                organization_id=organization_id,
            )
            return "orphan_unverifiable"
        if remaining < 0.01:
            # Keep the exhausted key in place (blocked): its occupied alias is what
            # makes "spent" durable — deleting it would let a later reconcile
            # re-mint a full grant.
            await _block_orphan(client, organization_id)
            log.info(
                "[starter_credits_bridge] orphaned key exhausted; not re-seeding",
                organization_id=organization_id,
            )
            return "exhausted_not_reseeded"
        log.warning(
            "[starter_credits_bridge] deleting orphaned key and re-minting remaining budget",
            organization_id=organization_id,
            remaining_usd=remaining,
        )
        await client.delete_keys(key_aliases=[organization_id])
        minted = await _mint(remaining)

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
    return "seeded"


async def _orphan_remaining_budget(
    client: StarterCreditsProxyClient,
    key_alias: str,
) -> Optional[float]:
    """The orphan's unspent budget in USD, rounded down to the cent; None when it
    cannot be read (fail closed: an unverifiable orphan is never re-minted)."""
    try:
        keys = await client.list_keys(key_alias=key_alias)
    except Exception:
        return None
    if not keys:
        return None

    entry = keys[0]
    max_budget = entry.get("max_budget")
    spend = entry.get("spend")
    for value in (max_budget, spend):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return None

    remaining_cents = int((max(0.0, max_budget - spend) + 1e-9) * 100)
    return remaining_cents / 100.0


async def _block_orphan(
    client: StarterCreditsProxyClient,
    key_alias: str,
) -> None:
    """Best-effort block of an exhausted orphan; the proxy's budget enforcement
    already refuses its calls, so a failed block only loses defense in depth."""
    try:
        keys = await client.list_keys(key_alias=key_alias)
        token = (keys[0] if keys else {}).get("token")
        if isinstance(token, str) and token:
            await client.block_key(key=token)
    except Exception:
        log.warning(
            "[starter_credits_bridge] could not block exhausted orphan",
            exc_info=True,
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


async def _resolve_mint_policy() -> Optional[MintPolicy]:
    """Resolve the mint policy: PostHog payload live-first with the Redis-cached
    copy as outage fallback, single fields overridable from env. The values are
    deliberately absent from source; no resolvable policy means no seeding."""
    flag = env.starter_credits_bridge.policy_flag

    payload: Optional[dict] = None
    posthog = _load_posthog()
    if posthog is not None:
        try:
            raw = posthog.get_feature_flag_payload(flag, "starter-credits-bridge")
        except Exception as exc:
            log.warning(
                "[starter_credits_bridge] live policy lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            payload = _parse_policy_payload(raw)
            if payload is not None:
                await set_cache(
                    namespace="starter_credits_bridge:policy",
                    key={"ff": flag},
                    value=payload,
                )

    if payload is None:
        cached = await get_cache(
            namespace="starter_credits_bridge:policy",
            key={"ff": flag},
            retry=False,
        )
        if isinstance(cached, dict):
            payload = cached

    config = env.starter_credits_bridge
    overrides = {
        "global_daily": config.global_daily_mint_cap,
        "global_hourly": config.global_hourly_mint_cap,
        "work_domain_daily": config.work_domain_daily_mint_cap,
        "freemail_domains": config.freemail_domains,
        "block_digit_locals": config.block_digit_locals,
    }
    merged = {**(payload or {})}
    merged.update({key: value for key, value in overrides.items() if value is not None})

    try:
        return MintPolicy(**merged)
    except Exception:
        log.warning(
            "[starter_credits_bridge] mint policy incomplete or invalid; seeding disabled (fail closed)",
        )
        return None


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


async def _mint_policy_allows(organization_email: str) -> bool:
    """Apply the mint policy: eligibility rules, then Redis counters (global
    daily + hourly; per-domain daily on non-free-mail domains only). Fail closed
    on a missing policy or Redis errors: an unverifiable mint is a skipped mint."""
    policy = await _resolve_mint_policy()
    if policy is None:
        return False

    local_part, _, domain = organization_email.rpartition("@")
    domain = domain.lower() or "unknown"
    freemail = policy.is_freemail(domain)

    if (
        not freemail
        and policy.block_digit_locals
        and any(character.isdigit() for character in local_part)
    ):
        log.warning(
            "[starter_credits_bridge] policy refused mint; skipping seed",
            rule="digit_local_part",
        )
        return False

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")

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
    if not freemail:
        counters.append(
            (
                f"starter_credits_bridge:mints:{day}:domain:{domain}",
                policy.work_domain_daily,
                _VELOCITY_COUNTER_TTL_SECONDS,
                "work_domain_daily",
            )
        )

    engine = get_cache_engine()
    try:
        for counter_key, cap, ttl, scope in counters:
            count = await engine.incr(counter_key)
            if count == 1:
                await engine.expire(counter_key, ttl)
            if count > cap:
                log.warning(
                    "[starter_credits_bridge] velocity cap reached; skipping seed",
                    scope=scope,
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

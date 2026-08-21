import asyncio
import hashlib
import hmac
import json
import math
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

import httpx

from oss.src.services import db_manager
from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
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
    UpdateSecretDTO,
    UpdateSecretPayloadDTO,
)
from oss.src.core.secrets.enums import CustomProviderKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.shared.dtos import Header

from ee.src.core.starter_credits_bridge.client import StarterCreditsProxyClient
from ee.src.core.starter_credits_bridge.types import MintPolicy

log = get_module_logger(__name__)

# Slug of the seeded vault connection; with the project+slug unique index it makes
# the vault write idempotent. NOT proof of ownership: a user can delete and
# recreate the slug, so every ownership-sensitive decision requires the exact
# pairing (the key's metadata.secret_id equals the row id) or an HMAC-valid
# grant record, never the slug or display fields alone.
STARTER_CREDITS_SLUG = "starter-credits"

# The connection's display name. It is ALSO the namespace of the stored model keys
# ("<name>/custom/<model>"), so once orgs are seeded it is a permanent contract:
# renaming it would orphan every seeded org's model selector.
STARTER_CREDITS_NAME = "Starter credits"

# Ownership marker carried in the proxy key's metadata (with the org id and the
# exact vault secret id). Key metadata is master-key-only mutable, so it is the
# unforgeable side of every ownership check.
ORIGIN_MARKER = "starter-credits-bridge"

# Namespaced field in the row's provider.extras holding the HMAC-signed grant
# record while a (re-)mint is in flight. The SDK exports extras into sandbox env
# through an allowlist, so this field never reaches a sandbox. The HMAC (keyed
# with the server-side crypt key) makes a user-edited or user-forged record
# verify as invalid: reconcile then treats the grant as unrecoverable rather
# than minting an attacker-chosen amount.
_GRANT_RECORD_FIELD = "starter_credits_bridge"

# Stand-in key value a row carries between its creation and the paired mint.
_PLACEHOLDER_KEY = "pending-rotation"

# Upper bound on the inline seeding work inside the signup path.
_SEED_TIMEOUT_SECONDS = 10.0

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
            "[starter_credits_bridge] seeding failed; organization stays unseeded",
            organization_id=organization_id,
            exc_info=True,
        )
        _send_alert_background(
            f"starter-credits-bridge: seeding failed for organization {organization_id}; "
            "it stays unseeded (reconcile to repair)"
        )


async def seed_starter_credits_bridge(
    *,
    organization_id: str,
    organization_email: str,
) -> None:
    """Mint a budget-capped virtual key and seed it into the org's default-project
    vault as a ready-to-use provider connection. The vault row is created BEFORE
    the mint and carries an HMAC-signed record of the authorized remaining, so a
    crash at any boundary leaves a durable record that reconcile converges from
    without ever increasing the organization's lifetime grant."""
    config = env.starter_credits_bridge
    if not config.armed:
        return

    if not await _feature_flag_enabled(organization_id):
        log.info(
            "[starter_credits_bridge] feature flag off; skipping seed",
            organization_id=organization_id,
        )
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
        # Idempotent re-entry; partial states are the reconcile endpoint's job.
        return

    if not await _mint_policy_allows(organization_email, policy):
        return

    try:
        outcome = await _provision(
            client=client,
            config=config,
            policy=policy,
            vault_service=vault_service,
            project_id=project.id,
            organization_id=organization_id,
            row=None,
            allow_fresh=True,
        )
    except Exception:
        await _release_velocity_slots(organization_email, policy)
        raise
    if outcome != "seeded":
        # The consumed velocity slot funded no mint; hand it back best-effort.
        await _release_velocity_slots(organization_email, policy)


async def reconcile_starter_credits_bridge(*, organization_id: str) -> str:
    """Repair partial seed states for one organization; returns the outcome.

    Manual and operator-run only (there is deliberately no automatic sweep),
    under one invariant that survives every failure boundary: a reconcile never
    increases an organization's total lifetime grant, and it never creates a
    FIRST grant (policy approval happens only on the signup path; an empty state
    reports "never_seeded" and mints nothing).
    """
    config = env.starter_credits_bridge
    if not config.armed:
        return "disabled"

    if not await _feature_flag_enabled(organization_id):
        return "flag_off"

    policy = await _resolve_mint_policy()
    if policy is None:
        return "policy_unavailable"

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
    entry = await _alias_entry(client, organization_id)
    if entry is not None and not _entry_is_ours(entry, organization_id):
        log.warning(
            "[starter_credits_bridge] alias held by a key without our marker; refusing",
            organization_id=organization_id,
        )
        return "foreign_key"

    if row is None and entry is None:
        return "never_seeded"

    if (
        row is not None
        and entry is not None
        and _paired(entry, row)
        and _read_grant_record(row, organization_id) is None
    ):
        return "healthy"

    outcome = await _provision(
        client=client,
        config=config,
        policy=policy,
        vault_service=vault_service,
        project_id=project.id,
        organization_id=organization_id,
        row=row,
        allow_fresh=False,
    )
    return "reseeded" if outcome == "seeded" else outcome


async def _provision(
    *,
    client: StarterCreditsProxyClient,
    config: StarterCreditsBridgeConfig,
    policy: MintPolicy,
    vault_service: VaultService,
    project_id: UUID,
    organization_id: str,
    row: Any,
    allow_fresh: bool,
) -> str:
    """Converge the org to exactly one paired (row, key). Order of operations is
    the invariant: the authorized remaining becomes durable (in a live key's
    budget or the row's signed record) BEFORE any destructive step, and every
    mint is bounded by that record and by the policy grant."""
    entry = await _alias_entry(client, organization_id)
    if entry is not None and not _entry_is_ours(entry, organization_id):
        log.warning(
            "[starter_credits_bridge] alias held by a key without our marker; refusing",
            organization_id=organization_id,
        )
        return "foreign_key"

    recorded = _read_grant_record(row, organization_id) if row is not None else None

    if entry is not None:
        remaining = _entry_remaining(entry)
        if remaining is None:
            log.error(
                "[starter_credits_bridge] key budget unreadable; refusing to re-mint",
                organization_id=organization_id,
            )
            return "orphan_unverifiable"
        if recorded is not None:
            remaining = min(remaining, recorded)
        remaining = min(remaining, policy.grant_usd)
        if remaining < 0.01:
            # Keep the exhausted key in place (blocked): its occupied alias is
            # what makes "spent" durable — deleting it would let a later
            # reconcile treat the org as never-seeded history-free.
            await _block_entry(client, entry)
            log.info(
                "[starter_credits_bridge] key exhausted; not re-seeding",
                organization_id=organization_id,
            )
            return "exhausted_not_reseeded"
        # Make the remaining durable BEFORE deleting the only live record of it.
        row = await _upsert_row_with_record(
            vault_service=vault_service,
            project_id=project_id,
            organization_id=organization_id,
            config=config,
            row=row,
            remaining=remaining,
        )
        await client.delete_keys(key_aliases=[organization_id])
    else:
        if row is None:
            if not allow_fresh:
                return "never_seeded"
            remaining = policy.grant_usd
            row = await _upsert_row_with_record(
                vault_service=vault_service,
                project_id=project_id,
                organization_id=organization_id,
                config=config,
                row=None,
                remaining=remaining,
            )
        else:
            if recorded is None:
                # No key and no valid record: historical spend is unknowable, so
                # the ruling is assume spent — minting anything here could
                # increase the lifetime grant.
                log.error(
                    "[starter_credits_bridge] row without key or valid grant record; assuming spent",
                    organization_id=organization_id,
                )
                return "grant_unrecoverable"
            remaining = min(recorded, policy.grant_usd)
            if remaining < 0.01:
                return "exhausted_not_reseeded"

    minted = await client.generate_key(
        key_alias=organization_id,
        max_budget=remaining,
        models=[config.model_id],
        metadata={
            "organization_id": organization_id,
            "origin": ORIGIN_MARKER,
            # Recorded AT mint (the row always exists by now), so the exact
            # pairing is never a best-effort afterthought.
            "secret_id": str(row.id),
        },
        team_id=config.team_id,
        max_parallel_requests=policy.key_max_parallel_requests,
        rpm_limit=policy.key_rpm_limit,
        tpm_limit=policy.key_tpm_limit,
    )

    await _finalize_row(
        vault_service=vault_service,
        project_id=project_id,
        row=row,
        config=config,
        virtual_key=minted.key,
    )

    log.info(
        "[starter_credits_bridge] seeded starter credits",
        organization_id=organization_id,
        project_id=str(project_id),
        secret_id=str(row.id),
    )
    return "seeded"


# --- proxy-side state ------------------------------------------------------


async def _alias_entry(
    client: StarterCreditsProxyClient,
    organization_id: str,
) -> Optional[dict]:
    keys = await client.list_keys(key_alias=organization_id)
    return keys[0] if keys else None


def _entry_is_ours(entry: dict, organization_id: str) -> bool:
    metadata = entry.get("metadata") or {}
    return (
        metadata.get("origin") == ORIGIN_MARKER
        and metadata.get("organization_id") == organization_id
    )


def _entry_remaining(entry: dict) -> Optional[float]:
    max_budget = entry.get("max_budget")
    spend = entry.get("spend")
    for value in (max_budget, spend):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return None
    remaining_cents = int((max(0.0, max_budget - spend) + 1e-9) * 100)
    return remaining_cents / 100.0


def _paired(entry: dict, row: Any) -> bool:
    metadata = entry.get("metadata") or {}
    return metadata.get("secret_id") == str(getattr(row, "id", None))


async def _block_entry(
    client: StarterCreditsProxyClient,
    entry: dict,
) -> None:
    """Best-effort block; the proxy's budget enforcement already refuses the
    key's calls, so a failed block only loses defense in depth."""
    token = entry.get("token")
    if not isinstance(token, str) or not token:
        return
    try:
        await client.block_key(key=token)
    except Exception:
        log.warning(
            "[starter_credits_bridge] could not block exhausted key",
            exc_info=True,
        )


# --- vault-side state ------------------------------------------------------


def _grant_record_signature(organization_id: str, remaining_cents: int) -> str:
    key = (env.agenta.crypt_key or "").encode()
    message = f"{ORIGIN_MARKER}:{organization_id}:{remaining_cents}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _build_grant_record(organization_id: str, remaining: float) -> dict:
    remaining_cents = int(round(remaining * 100))
    return {
        "remaining_usd": remaining_cents / 100.0,
        "signature": _grant_record_signature(organization_id, remaining_cents),
    }


def _read_grant_record(row: Any, organization_id: str) -> Optional[float]:
    """The row's recorded remaining in USD, or None when absent or when the
    signature does not verify (a user-edited or forged record reads as absent,
    which downstream means "grant unrecoverable", never a mint)."""
    data = getattr(row, "data", None)
    provider = getattr(data, "provider", None)
    extras = getattr(provider, "extras", None) or {}
    record = extras.get(_GRANT_RECORD_FIELD)
    if not isinstance(record, dict):
        return None
    remaining = record.get("remaining_usd")
    signature = record.get("signature")
    if not isinstance(remaining, (int, float)) or isinstance(remaining, bool):
        return None
    if not isinstance(signature, str):
        return None
    remaining_cents = int(round(remaining * 100))
    expected = _grant_record_signature(organization_id, remaining_cents)
    if not hmac.compare_digest(signature, expected):
        return None
    return remaining_cents / 100.0


def _row_data_dict(row: Any, config: StarterCreditsBridgeConfig) -> dict:
    data = getattr(row, "data", None)
    if data is not None and hasattr(data, "model_dump"):
        return data.model_dump()
    return _fresh_provider_data(config)


def _fresh_provider_data(config: StarterCreditsBridgeConfig) -> dict:
    return CustomProviderDTO(
        kind=CustomProviderKind.CUSTOM,
        provider=CustomProviderSettingsDTO(
            url=config.proxy_public_url,
            key=_PLACEHOLDER_KEY,
        ),
        models=[CustomModelSettingsDTO(slug=config.model_id)],
    ).model_dump()


async def _upsert_row_with_record(
    *,
    vault_service: VaultService,
    project_id: UUID,
    organization_id: str,
    config: StarterCreditsBridgeConfig,
    row: Any,
    remaining: float,
) -> Any:
    record = _build_grant_record(organization_id, remaining)

    if row is None:
        data = _fresh_provider_data(config)
        data["provider"]["extras"] = {_GRANT_RECORD_FIELD: record}
        created = await vault_service.create_secret(
            project_id=project_id,
            create_secret_dto=CreateSecretDTO(
                slug=STARTER_CREDITS_SLUG,
                header=Header(name=STARTER_CREDITS_NAME, description=ORIGIN_MARKER),
                secret=SecretDTO(
                    kind=SecretKind.CUSTOM_PROVIDER,
                    data=data,
                ),
            ),
        )
        await invalidate_cache(project_id=str(project_id))
        return created

    data = _row_data_dict(row, config)
    extras = dict(data.get("provider", {}).get("extras") or {})
    extras[_GRANT_RECORD_FIELD] = record
    data["provider"]["extras"] = extras
    await vault_service.update_secret(
        secret_id=row.id,
        project_id=project_id,
        update_secret_dto=UpdateSecretDTO(
            secret=UpdateSecretPayloadDTO(kind=SecretKind.CUSTOM_PROVIDER, data=data),
        ),
    )
    await invalidate_cache(project_id=str(project_id))
    return row


async def _finalize_row(
    *,
    vault_service: VaultService,
    project_id: UUID,
    row: Any,
    config: StarterCreditsBridgeConfig,
    virtual_key: str,
) -> None:
    data = _row_data_dict(row, config)
    data["provider"]["url"] = config.proxy_public_url
    data["provider"]["key"] = virtual_key
    extras = dict(data.get("provider", {}).get("extras") or {})
    extras.pop(_GRANT_RECORD_FIELD, None)
    data["provider"]["extras"] = extras or None
    await vault_service.update_secret(
        secret_id=row.id,
        project_id=project_id,
        update_secret_dto=UpdateSecretDTO(
            secret=UpdateSecretPayloadDTO(kind=SecretKind.CUSTOM_PROVIDER, data=data),
        ),
    )
    await invalidate_cache(project_id=str(project_id))


# --- gates -----------------------------------------------------------------


def _proxy_client(config: StarterCreditsBridgeConfig) -> StarterCreditsProxyClient:
    return StarterCreditsProxyClient(
        base_url=config.proxy_public_url,
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


async def _feature_flag_enabled(organization_id: str) -> bool:
    """Evaluate the PostHog kill switch, live-first so a flip takes effect on the
    next signup. Fail closed, per organization: on a PostHog outage the last
    Redis-cached decision FOR THIS ORGANIZATION stands in (never another org's);
    with no cached decision either, no seeding."""
    flag = env.starter_credits_bridge.feature_flag
    cache_key = {"ff": flag, "org": organization_id}

    posthog = _load_posthog()
    if posthog is not None:
        try:
            # The SDK call is synchronous; a worker thread keeps it preemptible
            # by the signup path's overall timeout.
            result = await asyncio.to_thread(
                posthog.feature_enabled, flag, organization_id
            )
        except Exception as exc:
            log.warning(
                "[starter_credits_bridge] live feature flag lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            enabled = result is True
            await set_cache(
                namespace="starter_credits_bridge:flag",
                key=cache_key,
                value=enabled,
            )
            return enabled

    cached = await get_cache(
        namespace="starter_credits_bridge:flag",
        key=cache_key,
        retry=False,
    )
    if cached is not None:
        return bool(cached)

    log.warning(
        "[starter_credits_bridge] no feature flag signal; seeding disabled (fail closed)",
    )
    return False


async def _resolve_mint_policy() -> Optional[MintPolicy]:
    """Resolve the mint policy. Live-first; a MALFORMED live payload fails
    closed with an alert (a bad rollout must never silently keep old caps via
    the cache) — only a transport failure may fall back to the Redis-cached
    payload. Env fields override single payload fields. No resolvable policy
    means no seeding."""
    flag = env.starter_credits_bridge.policy_flag
    cache_key = {"ff": flag}

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
                # A reachable PostHog with no payload is a real "no policy"
                # signal (env overrides may still complete it below).
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

    config = env.starter_credits_bridge
    overrides = {
        "global_daily": config.global_daily_mint_cap,
        "global_hourly": config.global_hourly_mint_cap,
        "work_domain_daily": config.work_domain_daily_mint_cap,
        "freemail_domains": config.freemail_domains,
        "block_digit_locals": config.block_digit_locals,
        "grant_usd": config.grant_usd,
        "key_max_parallel_requests": config.key_max_parallel_requests,
        "key_rpm_limit": config.key_rpm_limit,
        "key_tpm_limit": config.key_tpm_limit,
    }
    merged = {} if live_malformed else {**(payload or {})}
    merged.update({key: value for key, value in overrides.items() if value is not None})

    try:
        policy = MintPolicy(**merged)
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

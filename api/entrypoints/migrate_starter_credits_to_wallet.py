"""
migrate_starter_credits_to_wallet - one-off operator job (EE only) that moves each
organization's remaining starter-credits budget from the proxy into its wallet.

It works on the keys the starter-credits bridge minted: the program team's keys whose
metadata carries the bridge origin. It runs in two stages, because blocking a key stops
new requests but not the ones already running, and the proxy writes their spend later:

1. `--block` blocks every bridge key.
2. Wait for running requests and the proxy's spend writes to finish (10 minutes is ample).
3. `--apply` reads each blocked key's final spend and grants the remainder
   (`max_budget - spend`) as a `starter_credits` wallet credit that expires after twelve
   months, then deletes the organization's seeded "Agenta" vault connection: its key is
   blocked, so an agent that picked it would only fail. The gateway's built-in models
   (`builtin/agenta`) take its place in the model picker. A key that is not blocked yet is
   counted and left alone.

Turn seeding off (AGENTA_STARTER_CREDITS_BRIDGE_ENABLED=false) before `--block`, so no new
organization is given a connection the job then has to retire.

Run it against the deployment's own database and proxy, once the wallet funds the models:

    cd api
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --block
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --apply

Without a flag it only reads and counts. Both stages are idempotent (a blocked key stays
blocked, and the grant is once per organization), so a rerun finishes what a failed run left
and never grants twice. A key whose organization no longer exists is granted nothing.
Reads AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL, _MASTER_KEY and _TEAM_ID.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text

from ee.src.core.starter_credits_bridge.client import StarterCreditsProxyClient
from ee.src.core.starter_credits_bridge.service import (
    PROXY_ORIGIN,
    STARTER_CREDITS_SLUG,
)
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.core.secrets.managed import SecretManager
from oss.src.core.gateways.llms.registrar import LLMEndpointRegistrar
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

PAGE_SIZE = 100

DRY_RUN = "dry-run"
BLOCK = "block"
APPLY = "apply"

_MUSD_PER_USD = Decimal(1_000_000)

_ORGANIZATION_EXISTS = text(
    "SELECT 1 FROM organizations WHERE id = :organization_id AND deleted_at IS NULL"
)

_ORGANIZATION_PROJECTS = text(
    "SELECT id FROM projects WHERE organization_id = :organization_id"
)


@dataclass
class MigrationCounts:
    keys: int = 0
    skipped: int = 0
    no_organization: int = 0
    not_blocked: int = 0
    blocked: int = 0
    zero_remaining: int = 0
    granted: int = 0
    granted_musd: int = 0
    remaining_musd: int = 0
    connections_removed: int = 0
    failed: int = 0


def remaining_musd(info: dict[str, Any]) -> int:
    """`max_budget - spend` in musd, rounded down, never negative. Raises on a missing or
    non-numeric value: a guess would grant the whole budget or nothing."""
    try:
        max_budget = Decimal(str(info["max_budget"]))
        spend = Decimal(str(info["spend"]))
    except (KeyError, InvalidOperation) as exc:
        raise ValueError("key info carries no numeric max_budget and spend") from exc
    if not max_budget.is_finite() or not spend.is_finite():
        raise ValueError("key info carries a non-finite max_budget or spend")
    if max_budget < 0 or spend < 0:
        raise ValueError("key info carries a negative max_budget or spend")
    return max(0, int((max_budget - spend) * _MUSD_PER_USD))


def _organization_id(key: dict[str, Any]) -> Optional[UUID]:
    metadata = key.get("metadata") or {}
    try:
        return UUID(str(metadata.get("organization_id") or key.get("key_alias")))
    except ValueError:
        return None


async def _organization_exists(engine, organization_id: UUID) -> bool:
    async with engine.session() as session:
        row = await session.execute(
            _ORGANIZATION_EXISTS, {"organization_id": organization_id}
        )
        return row.first() is not None


async def _remove_bridge_connections(
    *, engine, vault: VaultService, organization_id: UUID
) -> int:
    """Delete the seeded "Agenta" connection from each of the organization's projects.

    Only the row the bridge manages: a user who saved their own connection under the same
    slug keeps it. Idempotent, so a rerun removes what a failed run left."""
    async with engine.session() as session:
        rows = await session.execute(
            _ORGANIZATION_PROJECTS, {"organization_id": organization_id}
        )
        project_ids = [row[0] for row in rows]

    removed = 0
    for project_id in project_ids:
        row = await vault.get_secret_by_slug(
            STARTER_CREDITS_SLUG, project_id=project_id
        )
        management = getattr(row, "management", None) if row is not None else None
        if (
            management is None
            or management.manager != SecretManager.STARTER_CREDITS_BRIDGE
        ):
            continue
        await vault.delete_managed_secret(
            secret_id=row.id,
            manager=SecretManager.STARTER_CREDITS_BRIDGE,
            project_id=project_id,
        )
        removed += 1
    return removed


async def _migrate_key(
    *,
    key: dict[str, Any],
    stage: str,
    client: StarterCreditsProxyClient,
    service: WalletsService,
    vault: VaultService,
    engine,
    counts: MigrationCounts,
) -> None:
    organization_id = _organization_id(key)
    token = key.get("token")
    if organization_id is None or not token:
        counts.skipped += 1
        log.warning(
            "[starter_credits_migration] key without organization or token; skipped",
            key_alias=key.get("key_alias"),
        )
        return

    if stage == BLOCK:
        if not key.get("blocked"):
            await client.block_key(key=token)
            counts.blocked += 1
        return

    if not await _organization_exists(engine, organization_id):
        counts.no_organization += 1
        return

    if stage == DRY_RUN:
        counts.remaining_musd += remaining_musd(key)
        return

    if not key.get("blocked"):
        counts.not_blocked += 1
        return

    amount_musd = remaining_musd(await client.get_key_info(key=token))
    counts.remaining_musd += amount_musd
    if amount_musd <= 0:
        counts.zero_remaining += 1
    else:
        credit = await service.grant_starter_credits(
            organization_id=organization_id,
            amount_musd=amount_musd,
        )
        counts.granted += 1
        counts.granted_musd += credit.amount_musd

    # After the grant, so a failed delete is retried by a rerun whose grant is a no-op.
    counts.connections_removed += await _remove_bridge_connections(
        engine=engine, vault=vault, organization_id=organization_id
    )


async def migrate_starter_credits(
    *,
    stage: str,
    client: StarterCreditsProxyClient,
    team_id: str,
    page_size: int = PAGE_SIZE,
) -> MigrationCounts:
    engine = get_transactions_engine()
    service = WalletsService(wallets_dao=WalletsDAO(engine=engine))
    # With the gateway registrar, so a deleted row also loses its LLM endpoint instead
    # of leaving it behind.
    vault = VaultService(
        SecretsDAO(),
        llm_endpoint_registrar=LLMEndpointRegistrar(
            llm_endpoints_dao=LLMEndpointsDAO(engine=engine),
        ),
    )
    counts = MigrationCounts()
    page = 1

    while True:
        keys = await client.list_team_keys(team_id=team_id, page=page, size=page_size)
        if not keys:
            break

        for key in keys:
            metadata = key.get("metadata") or {}
            if metadata.get("origin") != PROXY_ORIGIN:
                continue

            counts.keys += 1
            try:
                await _migrate_key(
                    key=key,
                    stage=stage,
                    client=client,
                    service=service,
                    vault=vault,
                    engine=engine,
                    counts=counts,
                )
            except Exception:
                # One bad key must not stop the rest; a rerun retries it.
                counts.failed += 1
                log.error(
                    "[starter_credits_migration] key failed",
                    key_alias=key.get("key_alias"),
                    exc_info=True,
                )

        log.info("[starter_credits_migration] page done", stage=stage, **vars(counts))

        # Blocking keeps a key in the list, so pages stay stable across the run.
        if len(keys) < page_size:
            break
        page += 1

    return counts


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    stage = parser.add_mutually_exclusive_group()
    stage.add_argument(
        "--block",
        dest="stage",
        action="store_const",
        const=BLOCK,
        help="Stage 1: block every starter-credits key.",
    )
    stage.add_argument(
        "--apply",
        dest="stage",
        action="store_const",
        const=APPLY,
        help="Stage 2, after the drain: grant each blocked key's remaining budget.",
    )
    parser.set_defaults(stage=DRY_RUN)
    parser.add_argument("--page-size", type=int, default=PAGE_SIZE)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    config = env.starter_credits_bridge
    if not (config.proxy_admin_url and config.master_key and config.team_id):
        print(
            "AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL, _MASTER_KEY and _TEAM_ID"
            " must be set",
            file=sys.stderr,
        )
        return 2

    counts = asyncio.run(
        migrate_starter_credits(
            stage=args.stage,
            client=StarterCreditsProxyClient(
                base_url=config.proxy_admin_url,
                master_key=config.master_key,
            ),
            team_id=config.team_id,
            page_size=args.page_size,
        )
    )
    print(
        f"starter credits migration ({args.stage}): "
        + " ".join(f"{name}={value}" for name, value in vars(counts).items())
    )
    return 1 if counts.failed else 0


if __name__ == "__main__":
    sys.exit(main())

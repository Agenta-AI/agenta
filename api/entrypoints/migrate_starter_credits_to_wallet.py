"""
migrate_starter_credits_to_wallet - one-off operator job (EE only) that moves each
organization's remaining starter-credits budget from the proxy into its wallet.

For every key the starter-credits bridge minted (the program team's keys whose metadata
carries the bridge origin), it blocks the key, reads the key's final spend, and grants the
remainder (`max_budget - spend`) as a `starter_credits` wallet credit that expires after
twelve months. Block first, then read: a key spending between the read and the block would
otherwise be paid twice.

Run it against the deployment's own database and proxy, once the wallet funds the models:

    cd api
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.migrate_starter_credits_to_wallet --apply

Without --apply it only reads and counts. The grant is idempotent per organization and the
block is idempotent on the proxy, so a rerun finishes what a failed run left and never
grants twice. A key whose organization no longer exists is blocked and granted nothing.
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
from ee.src.core.starter_credits_bridge.service import PROXY_ORIGIN
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

PAGE_SIZE = 100

_MUSD_PER_USD = Decimal(1_000_000)

_ORGANIZATION_EXISTS = text(
    "SELECT 1 FROM organizations WHERE id = :organization_id AND deleted_at IS NULL"
)


@dataclass
class MigrationCounts:
    keys: int = 0
    skipped: int = 0
    no_organization: int = 0
    zero_remaining: int = 0
    granted: int = 0
    granted_musd: int = 0
    remaining_musd: int = 0
    blocked: int = 0
    failed: int = 0


def remaining_musd(info: dict[str, Any]) -> int:
    """`max_budget - spend` in musd, rounded down, never negative."""
    try:
        max_budget = Decimal(str(info.get("max_budget")))
        spend = Decimal(str(info.get("spend") or 0))
    except InvalidOperation:
        return 0
    if not max_budget.is_finite() or not spend.is_finite():
        return 0
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


async def _migrate_key(
    *,
    key: dict[str, Any],
    apply: bool,
    client: StarterCreditsProxyClient,
    service: WalletsService,
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

    exists = await _organization_exists(engine, organization_id)
    if not exists:
        counts.no_organization += 1

    if not apply:
        if exists:
            counts.remaining_musd += remaining_musd(key)
        return

    if not key.get("blocked"):
        await client.block_key(key=token)
        counts.blocked += 1

    if not exists:
        return

    amount_musd = remaining_musd(await client.get_key_info(key=token))
    counts.remaining_musd += amount_musd
    if amount_musd <= 0:
        counts.zero_remaining += 1
        return

    credit = await service.grant_starter_credits(
        organization_id=organization_id,
        amount_musd=amount_musd,
    )
    counts.granted += 1
    counts.granted_musd += credit.amount_musd


async def migrate_starter_credits(
    *,
    apply: bool,
    client: StarterCreditsProxyClient,
    team_id: str,
    page_size: int = PAGE_SIZE,
) -> MigrationCounts:
    engine = get_transactions_engine()
    service = WalletsService(wallets_dao=WalletsDAO(engine=engine))
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
                    apply=apply,
                    client=client,
                    service=service,
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

        log.info("[starter_credits_migration] page done", apply=apply, **vars(counts))

        # Blocking keeps a key in the list, so pages stay stable across the run.
        if len(keys) < page_size:
            break
        page += 1

    return counts


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Block the keys and grant the credit. Without it the job only counts.",
    )
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
            apply=args.apply,
            client=StarterCreditsProxyClient(
                base_url=config.proxy_admin_url,
                master_key=config.master_key,
            ),
            team_id=config.team_id,
            page_size=args.page_size,
        )
    )
    mode = "apply" if args.apply else "dry-run"
    print(
        f"starter credits migration ({mode}): "
        + " ".join(f"{name}={value}" for name, value in vars(counts).items())
    )
    return 1 if counts.failed else 0


if __name__ == "__main__":
    sys.exit(main())

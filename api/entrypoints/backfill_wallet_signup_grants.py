"""
backfill_wallet_signup_grants - one-off operator job (EE only) that awards the signup
grant to organizations that never received it because they signed up while
AGENTA_WALLETS_ENABLED was off (open-designs item 15).

Run it once, against the deployment's own database, BEFORE turning the flag on:

    cd api
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.backfill_wallet_signup_grants
    AGENTA_LICENSE=ee uv run --no-sync python -m entrypoints.backfill_wallet_signup_grants --apply

Without --apply it only counts. Every award goes through `WalletsService.award`, which is
idempotent per organization, so a rerun or an overlap with live signups never
double-awards. Optional --created-from / --created-to (ISO 8601, [from, to)) narrow the
window on `organizations.created_at`.

An organization is eligible when it is not deleted, holds no signup-grant credit yet, and
is its owner's earliest organization. The last condition stands in for "created by
signup": the live flow awards the grant on the signup path only, never on
`POST /organizations/`, so a user's later organizations must not receive it here either.
An owner with any organization lacking `created_at` has no provable earliest one and is
skipped; award such a case by hand if it deserves the grant.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import text

from ee.src.core.wallets.grants import get_grant_rule
from ee.src.core.wallets.service import WalletsService
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

ACTIVITY_CODE = "signup"

BATCH_SIZE = 500

_ZERO_UUID = UUID(int=0)

_NEXT_ELIGIBLE_ORGANIZATION_IDS = text(
    """
    SELECT o.id
    FROM organizations o
    WHERE o.id > :cursor
      AND o.deleted_at IS NULL
      AND (CAST(:created_from AS timestamptz) IS NULL
           OR o.created_at >= CAST(:created_from AS timestamptz))
      AND (CAST(:created_to AS timestamptz) IS NULL
           OR o.created_at < CAST(:created_to AS timestamptz))
      AND o.created_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organizations earlier
        WHERE earlier.owner_id = o.owner_id
          AND earlier.id <> o.id
          AND (earlier.created_at IS NULL
               OR (earlier.created_at, earlier.id) < (o.created_at, o.id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM wallet_credits c
        WHERE c.organization_id = o.id AND c.credit_kind = :credit_kind
      )
    ORDER BY o.id
    LIMIT :batch
    """
)


@dataclass
class BackfillCounts:
    eligible: int = 0
    awarded: int = 0
    failed: int = 0


async def backfill_signup_grants(
    *,
    apply: bool,
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
    batch_size: int = BATCH_SIZE,
) -> BackfillCounts:
    credit_kind = get_grant_rule(activity_code=ACTIVITY_CODE).credit_kind
    engine = get_transactions_engine()
    service = WalletsService(wallets_dao=WalletsDAO(engine=engine))
    counts = BackfillCounts()
    cursor = _ZERO_UUID

    while True:
        async with engine.session() as session:
            organization_ids = (
                (
                    await session.execute(
                        _NEXT_ELIGIBLE_ORGANIZATION_IDS,
                        {
                            "cursor": cursor,
                            "created_from": created_from,
                            "created_to": created_to,
                            "credit_kind": credit_kind,
                            "batch": batch_size,
                        },
                    )
                )
                .scalars()
                .all()
            )

        if not organization_ids:
            break

        counts.eligible += len(organization_ids)

        if apply:
            for organization_id in organization_ids:
                try:
                    await service.award(
                        organization_id=organization_id,
                        activity_code=ACTIVITY_CODE,
                    )
                    counts.awarded += 1
                except Exception:
                    # One bad organization must not stop the rest; a rerun retries it.
                    counts.failed += 1
                    log.error(
                        "[WALLETS] Signup grant backfill failed for organization",
                        organization_id=str(organization_id),
                        exc_info=True,
                    )

        log.info(
            "[WALLETS] Signup grant backfill batch done",
            apply=apply,
            eligible=counts.eligible,
            awarded=counts.awarded,
            failed=counts.failed,
        )

        # The cursor, not the NOT EXISTS filter, guarantees progress: a dry run writes
        # nothing, and a failed award leaves its organization eligible.
        cursor = organization_ids[-1]

    return counts


def _aware_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Award the grants. Without it the job only counts eligible organizations.",
    )
    parser.add_argument("--created-from", type=_aware_datetime, default=None)
    parser.add_argument("--created-to", type=_aware_datetime, default=None)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    counts = asyncio.run(
        backfill_signup_grants(
            apply=args.apply,
            created_from=args.created_from,
            created_to=args.created_to,
            batch_size=args.batch_size,
        )
    )
    mode = "apply" if args.apply else "dry-run"
    print(
        f"signup grant backfill ({mode}): eligible={counts.eligible}"
        f" awarded={counts.awarded} failed={counts.failed}"
    )
    return 1 if counts.failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""Account tombstones: what a self-service deletion leaves behind, and what the signup
path does when the same email comes back.

Writing the tombstone is strict: the deletion aborts without it. Reading it at signup
fails open: a lookup failure grants as normal and logs a warning, so a database
hiccup never costs a real user the free credits.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.accounts.types import (
    AccountTombstone,
    AccountTombstoneCreate,
    AccountTombstonesDAOInterface,
    email_hash,
)
from ee.src.core.fraud.types import FraudCheckpoint, FraudDAOInterface

log = get_module_logger(__name__)


def _domain(email: str) -> Optional[str]:
    normalized = email.strip().lower()
    return normalized.split("@", 1)[1] if normalized.count("@") == 1 else None


class AccountTombstonesService:
    def __init__(
        self,
        *,
        tombstones_dao: AccountTombstonesDAOInterface,
        fraud_dao: FraudDAOInterface,
    ):
        self.tombstones_dao = tombstones_dao
        self.fraud_dao = fraud_dao
        if env.agenta.crypt_key == "replace-me":
            log.warning(
                "[accounts] AGENTA_CRYPT_KEY is the placeholder; account tombstone "
                "hashes are keyed by a public value"
            )

    async def record_deletion(
        self,
        *,
        email: str,
        organization_ids: List[UUID],
        now: Optional[datetime] = None,
    ) -> AccountTombstone:
        """Raises on any failure: the caller must not delete the account without it."""
        now = now or datetime.now(timezone.utc)
        totals = await self.tombstones_dao.read_wallet_totals(
            organization_ids=organization_ids
        )
        return await self.tombstones_dao.create(
            tombstone=AccountTombstoneCreate(
                email_hash=email_hash(email),
                deleted_at=now,
                organization_ids=list(organization_ids),
                credits_granted_musd=totals.granted_musd,
                credits_spent_musd=totals.spent_musd,
            )
        )

    async def find_recent(
        self,
        *,
        email: str,
        now: Optional[datetime] = None,
    ) -> Optional[AccountTombstone]:
        """The newest tombstone of the email inside the window, or None."""
        now = now or datetime.now(timezone.utc)
        window = timedelta(days=env.agenta.accounts.tombstone_days)
        return await self.tombstones_dao.find_newest(
            email_hash=email_hash(email),
            deleted_since=now - window,
        )

    async def block_grants_if_returning(
        self,
        *,
        organization_id: UUID,
        email: str,
    ) -> bool:
        """True when the email deleted an account inside the window. The new organization
        then carries the same no-grant marker the fraud check sets, so the daily grant
        skips it too. A lookup failure returns False and logs a warning."""
        now = datetime.now(timezone.utc)
        try:
            tombstone = await self.find_recent(email=email, now=now)
        except Exception as exc:
            log.warning(
                "[accounts] tombstone lookup failed; granting as normal",
                reason=type(exc).__name__,
            )
            return False
        if tombstone is None:
            return False

        age_days = max(0, (now - tombstone.deleted_at).days)
        log.info(
            "[accounts] returning deleted account; no free credits",
            domain=_domain(email),
            tombstone_age_days=age_days,
            organization_id=str(organization_id),
        )
        # The floor is the real guard: a daily credit minted without the marker sits
        # below it and cannot be spent. The marker only saves minting it. One retry.
        for attempt in (1, 2):
            try:
                await self.fraud_dao.mark_no_grants(
                    organization_id=organization_id,
                    checkpoint=FraudCheckpoint.RETURNING_ACCOUNT,
                    score=None,
                    now=now,
                )
                break
            except Exception as exc:
                emit = log.error if attempt == 2 else log.warning
                emit(
                    "[accounts] no-grant marker write failed for returning account",
                    reason=type(exc).__name__,
                    attempt=attempt,
                    organization_id=str(organization_id),
                )
        return True

    async def discard(self, *, tombstone_ids: List[UUID]) -> None:
        """Best effort: drop tombstones of a batch deletion that did not happen."""
        try:
            await self.tombstones_dao.delete(tombstone_ids=tombstone_ids)
        except Exception as exc:
            log.error(
                "[accounts] could not discard tombstones of an aborted deletion",
                reason=type(exc).__name__,
                tombstone_ids=[str(tid) for tid in tombstone_ids],
            )


_account_tombstones_service: Optional[AccountTombstonesService] = None


def register_account_tombstones_service(
    *, account_tombstones_service: AccountTombstonesService
) -> None:
    """Composition-root hook: the entrypoint wires the service at startup."""
    global _account_tombstones_service
    _account_tombstones_service = account_tombstones_service


def _get_account_tombstones_service() -> AccountTombstonesService:
    if _account_tombstones_service is None:
        raise RuntimeError(
            "Account tombstones service not registered. "
            "Call register_account_tombstones_service() from the composition root."
        )
    return _account_tombstones_service


async def write_account_tombstone(
    *, email: str, organization_ids: List[UUID]
) -> AccountTombstone:
    """The deletion seam, called from the OSS accounts service through `is_ee()`.
    Raises on failure."""
    return await _get_account_tombstones_service().record_deletion(
        email=email, organization_ids=organization_ids
    )


async def discard_account_tombstones(*, tombstone_ids: List[UUID]) -> None:
    """The compensation seam: the batch deletion raised after tombstones were written.
    Never raises."""
    try:
        await _get_account_tombstones_service().discard(tombstone_ids=tombstone_ids)
    except Exception as exc:
        log.error(
            "[accounts] could not discard tombstones of an aborted deletion",
            reason=type(exc).__name__,
        )


async def returning_account_blocks_grants(*, organization_id: UUID, email: str) -> bool:
    """The signup seam. Never raises: any failure grants as normal."""
    try:
        return await _get_account_tombstones_service().block_grants_if_returning(
            organization_id=organization_id, email=email
        )
    except Exception as exc:
        log.warning(
            "[accounts] returning account check failed; granting as normal",
            reason=type(exc).__name__,
        )
        return False

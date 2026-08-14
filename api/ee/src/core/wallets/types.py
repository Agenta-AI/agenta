"""EE core wallet domain types: DTOs, the DAO interface, and the pure settlement-planning
function. `plan_settlement` is deliberately DB-free so the replay/eligibility/split-funding/
deficit algorithm is unit-testable without Postgres; `WalletsDAOInterface` implementations
do the locking, ordered reads, and writes around it.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel

from ee.src.core.wallets.contracts import DebitCommandV1

# Explicit funding source used when a debit is not covered by any credit. Never a sequence
# or loop index — see the replay invariant in docs/design/wallets-research/v1/wave-1.md.
DEFICIT_SOURCE = "deficit"


class WalletError(Exception):
    """Base class for core wallet domain errors (distinct from the stream-level
    `ee.src.core.wallets.errors.WalletError` taxonomy, which covers envelope handling)."""


class WalletGeneralBalanceNotFoundError(WalletError):
    """The organization has no general (`wallet_credit_id IS NULL`) balance row.
    Provisioning that row is an explicit out-of-scope job for this package."""

    def __init__(self, organization_id: UUID):
        self.organization_id = organization_id
        super().__init__(
            f"No general wallet balance row for organization {organization_id}"
        )


# ---------------------------------------------------------------------------
# Domain DTOs
# ---------------------------------------------------------------------------


class WalletCreditDTO(BaseModel):
    id: UUID
    organization_id: UUID

    credit_kind: str
    amount_musd: int
    priority: int

    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    data: Dict[str, Any] = {}

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


class WalletDebitDTO(BaseModel):
    id: UUID
    organization_id: UUID

    debit_kind: str
    amount_musd: int

    wallet_credit_id: Optional[UUID] = None

    idempotency_key: str
    debit_key: str

    resource_key: str
    resource_locator: Dict[str, Any] = {}
    pricing_version: str

    data: Dict[str, Any] = {}

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


class WalletBalanceDTO(BaseModel):
    id: UUID
    organization_id: UUID

    wallet_credit_id: Optional[UUID] = None
    balance_musd: int
    floor_musd: Optional[int] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None


class PlanChangeResultDTO(BaseModel):
    """Result of `WalletsDAOInterface.apply_plan_change`. `replayed=True` means this exact
    `idempotency_key` had already been applied — the returned ids/amounts are the
    ORIGINAL application's, and no new row was written on this call."""

    replayed: bool

    outgoing_credit_id: Optional[UUID] = None
    outgoing_debit_id: Optional[UUID] = None
    outgoing_debit_amount_musd: int = 0

    incoming_credit_id: Optional[UUID] = None
    incoming_credit_amount_musd: int = 0

    general_balance_musd: int
    floor_musd: Optional[int] = None


class CreditCandidateDTO(BaseModel):
    """One credit + its current balance. `plan_settlement` re-derives both expiry and
    ordering itself (below) — the caller does not need to pre-filter or pre-sort, though
    the DAO's SQL does so too, as an index-backed optimization over the same rule."""

    wallet_credit_id: UUID
    credit_kind: str
    priority: int
    end_time: Optional[datetime] = None
    balance_musd: int


# ---------------------------------------------------------------------------
# Code-configured credit applicability.
#
# The service recognises no model, provider, metric key, gateway kind, or measurement id —
# only a generic `credit_kind` naming convention matched against the gateway-composed
# `resource_key` string. General-purpose kinds fund any resource; a `restricted:<prefix>`
# kind funds only resource keys starting with that prefix.
# ---------------------------------------------------------------------------

GENERAL_CREDIT_KINDS = frozenset(
    {
        "plan_allowance",
        "purchase",
        "award",
        "provider_credit",
        "adjustment",
    }
)
RESTRICTED_CREDIT_KIND_PREFIX = "restricted:"


def is_resource_eligible(*, credit_kind: str, resource_key: str) -> bool:
    if credit_kind in GENERAL_CREDIT_KINDS:
        return True

    if credit_kind.startswith(RESTRICTED_CREDIT_KIND_PREFIX):
        allowed_prefix = credit_kind[len(RESTRICTED_CREDIT_KIND_PREFIX) :]
        return resource_key.startswith(allowed_prefix)

    # Unconfigured credit_kind: fail closed rather than silently fund a posting.
    return False


def compose_debit_key(*, idempotency_key: str, source: str) -> str:
    """Every debit_key is derived from the posting key plus its actual funding source
    (a `wallet_credit_id`, or the explicit `deficit` literal) — never a sequence."""
    return f"{idempotency_key}:{source}"


# ---------------------------------------------------------------------------
# Settlement plan
# ---------------------------------------------------------------------------


class DebitWriteDTO(BaseModel):
    debit_key: str
    wallet_credit_id: Optional[UUID] = None
    amount_musd: int


class SettlementPlan(BaseModel):
    debit_writes: List[DebitWriteDTO]
    # wallet_credit_id -> musd to subtract from that credit's balance row.
    credit_balance_deltas: Dict[UUID, int]
    # musd to subtract from the organization's general balance row.
    general_balance_delta: int


_FAR_FUTURE = datetime.max.replace(tzinfo=timezone.utc)


def plan_settlement(
    *,
    command: DebitCommandV1,
    candidates: List[CreditCandidateDTO],
    now: Optional[datetime] = None,
) -> SettlementPlan:
    """Pure planning function: given one posting and its candidate credits (any order,
    expired or not), decide which credits fund it, how much each contributes, and the
    deficit remainder if any.

    Filters expired credits and sorts the rest by priority, end_time (soonest-expiring
    first; no-expiry last), then wallet_credit_id (the deterministic tiebreak) itself, so
    the whole algorithm is unit-testable without Postgres. The DAO's SQL applies the same
    unexpired-and-ordered predicate too, as a scan/lock-order optimization over this same
    rule — not a second source of truth.

    No I/O, no locking. Callers (the DAO) apply the returned plan inside the same
    transaction that locked the selected balance rows.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    eligible_candidates = sorted(
        (c for c in candidates if c.end_time is None or c.end_time > now),
        key=lambda c: (c.priority, c.end_time or _FAR_FUTURE, c.wallet_credit_id),
    )

    remaining = command.amount_musd
    debit_writes: List[DebitWriteDTO] = []
    credit_balance_deltas: Dict[UUID, int] = {}

    for candidate in eligible_candidates:
        if remaining <= 0:
            break

        if candidate.balance_musd <= 0:
            continue

        if not is_resource_eligible(
            credit_kind=candidate.credit_kind,
            resource_key=command.resource_key,
        ):
            continue

        funded = min(remaining, candidate.balance_musd)
        if funded <= 0:
            continue

        debit_writes.append(
            DebitWriteDTO(
                debit_key=compose_debit_key(
                    idempotency_key=command.idempotency_key,
                    source=str(candidate.wallet_credit_id),
                ),
                wallet_credit_id=candidate.wallet_credit_id,
                amount_musd=funded,
            )
        )
        credit_balance_deltas[candidate.wallet_credit_id] = funded
        remaining -= funded

    if remaining > 0:
        debit_writes.append(
            DebitWriteDTO(
                debit_key=compose_debit_key(
                    idempotency_key=command.idempotency_key,
                    source=DEFICIT_SOURCE,
                ),
                wallet_credit_id=None,
                amount_musd=remaining,
            )
        )

    return SettlementPlan(
        debit_writes=debit_writes,
        credit_balance_deltas=credit_balance_deltas,
        general_balance_delta=command.amount_musd,
    )


# ---------------------------------------------------------------------------
# DAO interface
# ---------------------------------------------------------------------------


class WalletsDAOInterface(ABC):
    @abstractmethod
    async def get_general_balance(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletBalanceDTO]:
        """Read-only, unlocked: the organization's general balance row, or `None` if not
        provisioned. Used by the write-free `check()` path."""
        raise NotImplementedError

    @abstractmethod
    async def settle(
        self,
        *,
        command: DebitCommandV1,
    ) -> List[WalletDebitDTO]:
        """Apply (or replay) one debit posting in a single transaction. Returns the debit
        rows for that posting — freshly created on a first delivery, or the original rows
        unchanged on replay."""
        raise NotImplementedError

    @abstractmethod
    async def provision_general_balance(
        self,
        *,
        organization_id: UUID,
        floor_musd: int = 0,
    ) -> None:
        """Idempotently insert the organization's general (`wallet_credit_id IS NULL`)
        balance row at `balance_musd=0`. Calling this twice (retry, concurrent creation)
        must insert nothing on the second call — implementations rely on the partial
        unique index `uq_wallet_balances_org_general` as the actual guard, not on an
        application-level check-then-insert."""
        raise NotImplementedError

    @abstractmethod
    async def get_active_plan_allowance_credit(
        self,
        *,
        organization_id: UUID,
    ) -> Optional[WalletCreditDTO]:
        """The organization's current, unexpired `plan_allowance`-kind credit, if any —
        the "outgoing" credit a plan change prorates a remainder out of. Wave 1 assumes
        at most one such credit is active at a time."""
        raise NotImplementedError

    @abstractmethod
    async def apply_plan_change(
        self,
        *,
        organization_id: UUID,
        idempotency_key: str,
        outgoing_credit_id: Optional[UUID],
        outgoing_debit_amount_musd: int,
        incoming_credit_kind: str,
        incoming_credit_amount_musd: int,
        incoming_priority: int,
        incoming_end_time: datetime,
        floor_musd: int,
        now: Optional[datetime] = None,
    ) -> "PlanChangeResultDTO":
        """Apply (or replay) one plan-change proration in a single transaction:

        1. Replay guard, keyed on `(organization_id, idempotency_key)` — a redelivered
           webhook must produce no second financial effect. There is no dedicated ledger
           table for this: the outgoing side is guarded by the same mechanism `settle()`
           uses against `wallet_debits`, and the incoming side by the
           `plan_change_idempotency_key` reference already stored on the minted
           `wallet_credits` row (step 3) — reading the actual financial rows a prior
           application wrote, not a second guard.
        2. If `outgoing_debit_amount_musd > 0` and `outgoing_credit_id` is set: write an
           IMMUTABLE `wallet_debits` row (`debit_kind="adjustment"`) against that credit,
           capped at the credit's current balance (a per-credit balance must never go
           negative), and decrement that credit's balance row by the same amount.
        3. If `incoming_credit_amount_musd > 0`: mint a NEW immutable `wallet_credits` row
           (never mutate an existing one) plus its balance row.
        4. Update the general balance projection by `(applied incoming - applied
           outgoing)`, and set its `floor_musd` to the incoming plan's floor.

        Amounts that round to zero are computed but not written — Postgres's
        `amount_musd > 0` check constraint on both `wallet_credits` and `wallet_debits`
        forbids a zero-amount row. When BOTH amounts round to zero, this call writes
        nothing at all beyond the general balance's floor projection: a no-op is a
        correct outcome for a zero-value change, and there is no financial effect to
        replay-guard.
        """
        raise NotImplementedError

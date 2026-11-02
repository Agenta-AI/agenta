"""DBE <-> DTO mapping for the wallet domain. Lives only in the DB layer, per
`api/AGENTS.md` layering rules — `ee.src.core.wallets` never imports SQLAlchemy models.
"""

from ee.src.core.wallets.contracts import DebitCommandV1
from ee.src.core.wallets.types import (
    CreditCandidateDTO,
    DebitWriteDTO,
    WalletBalanceDTO,
    WalletCreditDTO,
    WalletDebitDTO,
)
from ee.src.dbs.postgres.wallets.dbes import (
    WalletBalanceDBE,
    WalletCreditDBE,
    WalletDebitDBE,
)


def credit_dbe_to_dto(dbe: WalletCreditDBE) -> WalletCreditDTO:
    return WalletCreditDTO(
        id=dbe.id,
        organization_id=dbe.organization_id,
        credit_kind=dbe.credit_kind,
        amount_musd=dbe.amount_musd,
        priority=dbe.priority,
        start_time=dbe.start_time,
        end_time=dbe.end_time,
        data=dbe.data or {},
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
    )


def debit_dbe_to_dto(dbe: WalletDebitDBE) -> WalletDebitDTO:
    return WalletDebitDTO(
        id=dbe.id,
        organization_id=dbe.organization_id,
        debit_kind=dbe.debit_kind,
        amount_musd=dbe.amount_musd,
        wallet_credit_id=dbe.wallet_credit_id,
        idempotency_key=dbe.idempotency_key,
        debit_key=dbe.debit_key,
        resource_key=dbe.resource_key,
        resource_locator=dbe.resource_locator or {},
        pricing_version=dbe.pricing_version,
        data=dbe.data or {},
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
    )


def balance_dbe_to_dto(dbe: WalletBalanceDBE) -> WalletBalanceDTO:
    return WalletBalanceDTO(
        id=dbe.id,
        organization_id=dbe.organization_id,
        wallet_credit_id=dbe.wallet_credit_id,
        balance_musd=dbe.balance_musd,
        floor_musd=dbe.floor_musd,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
    )


def candidate_from_dbes(
    *,
    credit: WalletCreditDBE,
    balance: WalletBalanceDBE,
) -> CreditCandidateDTO:
    return CreditCandidateDTO(
        wallet_credit_id=credit.id,
        credit_kind=credit.credit_kind,
        priority=credit.priority,
        end_time=credit.end_time,
        balance_musd=balance.balance_musd,
    )


def debit_write_to_dbe(
    *,
    write: DebitWriteDTO,
    command: DebitCommandV1,
    debit_id,
) -> WalletDebitDBE:
    return WalletDebitDBE(
        id=debit_id,
        organization_id=command.organization_id,
        debit_kind=command.debit_kind.value,
        amount_musd=write.amount_musd,
        wallet_credit_id=write.wallet_credit_id,
        idempotency_key=command.idempotency_key,
        debit_key=write.debit_key,
        resource_key=command.resource_key,
        resource_locator=command.resource_locator or {},
        pricing_version=command.pricing_version,
        data={},
        created_at=command.created_at,
    )

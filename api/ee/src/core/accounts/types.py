"""Contracts of the account tombstone.

A self-service account deletion leaves one tombstone behind: the hash of the email
(never the address), when it happened, which organizations went with it, and the
credits they were granted and spent. The signup path reads it so the same email cannot
collect the free credits again inside `AGENTA_ACCOUNT_TOMBSTONE_DAYS`.
"""

import hashlib
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


# Providers that ignore dots in the local part: `us.er@gmail.com` is `user@gmail.com`.
_DOTLESS_LOCAL_DOMAINS = frozenset({"gmail.com", "googlemail.com"})


def normalize_email(email: str) -> str:
    """The provider-normalized form that is hashed: lowercased and stripped, a `+tag`
    suffix dropped from the local part for every domain, and the dots removed from the
    local part for the `_DOTLESS_LOCAL_DOMAINS`. So `User+a@gmail.com`, `user+b@gmail.com`
    and `us.er@gmail.com` are one address. An address without exactly one `@` is only
    lowercased and stripped."""
    normalized = email.strip().lower()
    if normalized.count("@") != 1:
        return normalized
    local, domain = normalized.split("@", 1)
    local = local.partition("+")[0]
    if domain in _DOTLESS_LOCAL_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}"


def email_hash(email: str) -> str:
    """Hex SHA-256 of `normalize_email(email)`. The only form stored."""
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


class WalletTotals(BaseModel):
    """Credits granted and spent across a set of organizations, in micro-dollars."""

    granted_musd: int = 0
    spent_musd: int = 0


class AccountTombstoneCreate(BaseModel):
    email_hash: str
    deleted_at: datetime
    organization_ids: List[UUID]
    credits_granted_musd: int
    credits_spent_musd: int


class AccountTombstone(AccountTombstoneCreate):
    id: UUID


class AccountTombstonesDAOInterface(ABC):
    @abstractmethod
    async def read_wallet_totals(self, *, organization_ids: List[UUID]) -> WalletTotals:
        """Sum of every wallet credit and every wallet debit of the organizations."""
        raise NotImplementedError

    @abstractmethod
    async def create(self, *, tombstone: AccountTombstoneCreate) -> AccountTombstone:
        raise NotImplementedError

    @abstractmethod
    async def find_newest(
        self, *, email_hash: str, deleted_since: datetime
    ) -> Optional[AccountTombstone]:
        """The newest tombstone of the hash deleted at or after `deleted_since`."""
        raise NotImplementedError

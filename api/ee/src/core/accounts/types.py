"""Contracts of the account tombstone.

A self-service account deletion leaves one tombstone behind: the hash of the email
(never the address), when it happened, which organizations went with it, and the
credits they were granted and spent. The signup path reads it so the same email cannot
collect the free credits again inside `AGENTA_ACCOUNT_TOMBSTONE_DAYS`.
"""

import hashlib
import hmac
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.utils.env import env


# Google delivers both domains to one mailbox and ignores dots in the local part:
# `us.er@googlemail.com` is `user@gmail.com`.
_GMAIL_DOMAIN = "gmail.com"
_GMAIL_ALIASES = frozenset({"gmail.com", "googlemail.com"})


def normalize_email(email: str) -> str:
    """The provider-normalized form that is hashed: lowercased and stripped, a `+tag`
    suffix dropped from the local part for every domain, and for Gmail the dots removed
    from the local part and `googlemail.com` folded into `gmail.com`. So
    `User+a@gmail.com`, `user+b@gmail.com`, `us.er@gmail.com` and `user@googlemail.com`
    are one address. An address without exactly one `@` is only lowercased and
    stripped."""
    normalized = email.strip().lower()
    if normalized.count("@") != 1:
        return normalized
    local, domain = normalized.split("@", 1)
    local = local.partition("+")[0]
    if domain in _GMAIL_ALIASES:
        local = local.replace(".", "")
        domain = _GMAIL_DOMAIN
    return f"{local}@{domain}"


def email_hash(email: str) -> str:
    """Hex HMAC-SHA256 of `normalize_email(email)`, keyed by `AGENTA_CRYPT_KEY`. The
    only form stored. The key makes the table useless to anyone who takes it without
    the deployment's secrets. Rotating the key orphans the older tombstones: the window
    restarts for every email."""
    return hmac.new(
        env.agenta.crypt_key.encode("utf-8"),
        normalize_email(email).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


class WalletTotals(BaseModel):
    """Credits granted and spent across a set of organizations, in micro-dollars."""

    granted_musd: int = 0
    spent_musd: int = 0


class AccountTombstoneCreate(BaseModel):
    email_hash: str
    account_deleted_at: datetime
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
    async def delete(self, *, tombstone_ids: List[UUID]) -> None:
        """Remove tombstones whose deletion did not happen after all."""
        raise NotImplementedError

    @abstractmethod
    async def find_newest(
        self, *, email_hash: str, deleted_since: datetime
    ) -> Optional[AccountTombstone]:
        """The newest tombstone of the hash whose account was deleted at or after
        `deleted_since`."""
        raise NotImplementedError

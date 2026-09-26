"""Read-side DTOs for the wallet usage view: what an organization holds and what it spent.

Amounts are raw micro-dollars. The view reports; it never decides anything a debit or a
credit already decided.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class WalletCreditUsage(BaseModel):
    id: UUID
    credit_kind: str
    amount_musd: int
    remaining_musd: int
    priority: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    created_at: Optional[datetime] = None


class WalletUsageSummary(BaseModel):
    spendable_musd: Optional[int] = None
    general_balance_musd: Optional[int] = None
    floor_musd: Optional[int] = None
    # The original amounts of the credits active now. With no recurring allowance yet,
    # this is what "remaining of total" is measured against.
    active_credit_total_musd: int = 0
    credits: List[WalletCreditUsage] = Field(default_factory=list)


class WalletUsageDebit(BaseModel):
    """One posting, summed over its funding sources: a settlement split across two
    credits writes two debit rows under one idempotency key."""

    idempotency_key: str
    amount_musd: int
    resource_key: str
    resource_locator: Dict[str, Any] = Field(default_factory=dict)
    pricing_version: str
    created_at: datetime


class MeasurementUsage(BaseModel):
    measurement_id: str
    project_id: UUID
    user_id: Optional[UUID] = None
    agent_id: Optional[UUID] = None
    references: Dict[str, Any] = Field(default_factory=dict)
    components: Dict[str, int] = Field(default_factory=dict)
    end_time: Optional[datetime] = None


class WalletUsageCharge(BaseModel):
    created_at: datetime
    category: str
    resource_key: str
    model: Optional[str] = None
    provider: Optional[str] = None
    amount_musd: int
    pricing_version: str
    measurement_id: Optional[str] = None
    project_id: Optional[UUID] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    request_count: Optional[int] = None


class WalletUsageDay(BaseModel):
    day: date
    category: str
    amount_musd: int
    charge_count: int


class WalletUsageSession(BaseModel):
    # None groups the charges no session was named for, per user and day.
    session_id: Optional[str] = None
    agent_id: Optional[UUID] = None
    agent_name: Optional[str] = None
    user_id: Optional[UUID] = None
    user_email: Optional[str] = None
    started_at: datetime
    last_at: datetime
    amount_musd: int
    charge_count: int
    charges: List[WalletUsageCharge] = Field(default_factory=list)


class WalletUsage(BaseModel):
    start: datetime
    end: datetime
    # True when the window held more postings than the read returns.
    truncated: bool = False
    days: List[WalletUsageDay] = Field(default_factory=list)
    sessions: List[WalletUsageSession] = Field(default_factory=list)

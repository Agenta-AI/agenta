from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field

from ee.src.core.wallets.usage.dtos import WalletUsage, WalletUsageSummary


class WalletUsageQueryRequest(BaseModel):
    start: Optional[datetime] = None
    end: Optional[datetime] = None


class WalletSummaryResponse(BaseModel):
    summary: WalletUsageSummary
    # The organization's `wallets-rollout` mode: `off`, `shadow` or `enforce`.
    mode: str


class WalletUsageResponse(BaseModel):
    usage: WalletUsage


# The runner's turn id: a lock value it mints, not a stored key.
TurnId = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
]


class SandboxAdmissionRequest(BaseModel):
    # Without one the turn is not counted against the organization's running turns.
    turn_id: Optional[TurnId] = None
    # The session the turn runs in. With it, the gateway serves the turn's model calls to
    # its end without a balance check; without it, each call is checked.
    session_id: Optional[str] = Field(default=None, min_length=1, max_length=128)


class SandboxTurnLimit(BaseModel):
    seconds: int
    # What the chat says when a turn is stopped at this limit.
    message: str


class SandboxAdmissionResponse(BaseModel):
    allowed: bool
    # A refusal's stable class and the line the person reads.
    code: Optional[str] = None
    message: Optional[str] = None
    turn_limit: Optional[SandboxTurnLimit] = None
    # The turn counts against the organization's running turns until it is released.
    slot_held: bool = False


class SandboxTurnRequest(BaseModel):
    turn_id: TurnId
    session_id: Optional[str] = Field(default=None, min_length=1, max_length=128)


class SandboxUsageRecordResponse(BaseModel):
    # None when the organization's wallet is `off`: acknowledged, not measured.
    measurement_id: Optional[str] = None

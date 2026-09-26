from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from ee.src.core.wallets.usage.dtos import WalletUsage, WalletUsageSummary


class WalletUsageQueryRequest(BaseModel):
    start: Optional[datetime] = None
    end: Optional[datetime] = None


class WalletSummaryResponse(BaseModel):
    summary: WalletUsageSummary


class WalletUsageResponse(BaseModel):
    usage: WalletUsage

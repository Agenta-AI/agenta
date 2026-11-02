from typing import List, Literal, Optional

from pydantic import BaseModel

# Whether this organization can buy a pack now: `available`, `paid_plan_required` (the
# free plan, or no Stripe subscription), or `unavailable` (the wallet is off or not
# enforced for the organization, or Stripe or its webhook is not configured).
TopUpStatus = Literal["available", "paid_plan_required", "unavailable"]


class TopUpPackResponse(BaseModel):
    code: str
    credits: int
    price_cents: int
    currency: Literal["usd"] = "usd"
    # Purchased credits expire this many days after the payment.
    expires_after_days: int


class TopUpPacksResponse(BaseModel):
    status: TopUpStatus
    packs: List[TopUpPackResponse]


class TopUpPurchaseResponse(BaseModel):
    # Whether the payment event has arrived and granted the pack.
    credited: bool
    # The credits granted, once credited.
    credits: Optional[int] = None

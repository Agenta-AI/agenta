"""Credit that arrives with a payment or a transfer, not with a catalog activity: one-time
top-up packs bought through Stripe Checkout, and the one-off transfer of each
organization's remaining starter-credits proxy budget into the wallet."""

from dataclasses import dataclass
from typing import Dict, Optional

from ee.src.core.wallets.grants import TWELVE_MONTHS_DAYS

# 1 credit = 1 cent; $1 = 1_000_000 musd.
MUSD_PER_CREDIT = 10_000

PURCHASE_CREDIT_KIND = "purchase"
# Spent last: it is paid for and lasts the longest.
PURCHASE_PRIORITY = 70
PURCHASE_LIFETIME_DAYS = TWELVE_MONTHS_DAYS

# The remaining budget of an organization's starter-credits proxy key, moved into the
# wallet by `entrypoints.migrate_starter_credits_to_wallet`. Same footing as the signup
# grant it replaces.
STARTER_CREDITS_KIND = "starter_credits"
STARTER_CREDITS_PRIORITY = 20
STARTER_CREDITS_LIFETIME_DAYS = TWELVE_MONTHS_DAYS


@dataclass(frozen=True)
class TopUpPack:
    code: str
    price_cents: int
    credits: int

    @property
    def amount_musd(self) -> int:
        return self.credits * MUSD_PER_CREDIT


# PRODUCT DECISION (2026-10-02): paid plans only, no volume bonus.
TOP_UP_PACKS: Dict[str, TopUpPack] = {
    pack.code: pack
    for pack in (
        TopUpPack(code="credits_1000", price_cents=1_000, credits=1_000),
        TopUpPack(code="credits_2500", price_cents=2_500, credits=2_500),
        TopUpPack(code="credits_10000", price_cents=10_000, credits=10_000),
    )
}


def get_top_up_pack(*, code: Optional[str]) -> Optional[TopUpPack]:
    return TOP_UP_PACKS.get(code) if code else None

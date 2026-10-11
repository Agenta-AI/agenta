import type {ReactNode} from "react"

import {Gift, ShoppingBag} from "@phosphor-icons/react"

import {CreditGroupTile} from "./CreditGroupTile"
import {CreditSourceTile} from "./CreditSourceTile"
import type {WalletCredit, WalletSummary} from "./walletApi"
import {WalletCard} from "./WalletCard"
import {activeCredits, walletHealth} from "./walletCredits"

const STATUS = {
    active: {label: "Active", tone: "success"},
    low: {label: "Running low", tone: "warning"},
    empty: {label: "Empty", tone: "error"},
} as const

/** Credits that come back on a schedule; each keeps its own tile. */
const RECURRING = ["plan_allowance", "daily_free"]

/** One tile for a single credit, a folded tile for several. */
const group = (label: string, icon: ReactNode, credits: WalletCredit[]) =>
    credits.length === 1 ? (
        <CreditSourceTile key={credits[0].id} credit={credits[0]} />
    ) : credits.length ? (
        <CreditGroupTile key={label} label={label} icon={icon} credits={credits} />
    ) : null

/** The balance as the wallet card, the recurring credits as tiles, and one-time credits folded. */
export const CreditsHero = ({
    wallet,
    dailyMusd,
}: {
    wallet: WalletSummary
    /** The recent average spend per day, for the running-low status. */
    dailyMusd: number | null
}) => {
    const balance = Math.max(0, wallet.spendable_musd ?? 0)
    const status = STATUS[walletHealth(balance, dailyMusd)]
    const credits = activeCredits(wallet)

    return (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <WalletCard
                balanceMusd={balance}
                status={status.label}
                statusTone={status.tone}
                interactive
                size="compact"
            />
            {credits.length ? (
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                    {RECURRING.flatMap((kind) =>
                        credits
                            .filter((credit) => credit.credit_kind === kind)
                            .map((credit) => <CreditSourceTile key={credit.id} credit={credit} />),
                    )}
                    {group(
                        "Bonus credits",
                        <Gift size={14} />,
                        credits.filter(
                            (credit) =>
                                !RECURRING.includes(credit.credit_kind) &&
                                credit.credit_kind !== "purchase",
                        ),
                    )}
                    {group(
                        "Purchased",
                        <ShoppingBag size={14} />,
                        credits.filter((credit) => credit.credit_kind === "purchase"),
                    )}
                </div>
            ) : (
                <div className="bg-muted text-muted-foreground flex h-[140px] items-center justify-center rounded-xl p-4 text-center text-[13px]">
                    No credits left right now.
                </div>
            )}
        </div>
    )
}

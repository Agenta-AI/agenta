import {CreditSourceTile} from "./CreditSourceTile"
import type {WalletSummary} from "./walletApi"
import {WalletCard} from "./WalletCard"
import {activeCredits, walletHealth} from "./walletCredits"

const STATUS = {
    active: {label: "Active", tone: "success"},
    low: {label: "Running low", tone: "warning"},
    empty: {label: "Empty", tone: "error"},
} as const

/** The balance as the wallet card, then one tile per credit it draws on. */
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
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
                    {credits.map((credit) => (
                        <CreditSourceTile key={credit.id} credit={credit} />
                    ))}
                </div>
            ) : (
                <div className="bg-muted text-muted-foreground flex h-[140px] items-center justify-center rounded-xl p-4 text-center text-[13px]">
                    No credits left right now.
                </div>
            )}
        </div>
    )
}

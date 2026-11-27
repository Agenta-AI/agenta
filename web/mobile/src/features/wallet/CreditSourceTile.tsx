import {useT} from "@agenta/i18n"
import walletCreditsCatalog from "@agenta/i18n/catalogs/wallet.credits"
import {analyticsColor} from "@agenta/observability-ui/analytics"

import {AnimatedNumber} from "@/components/AnimatedNumber"

import type {WalletCredit} from "./walletApi"
import {creditKind, formatCredits} from "./walletFormat"

/** One credit the balance draws on: what it is, what is left of it, and when it runs out. */
export const CreditSourceTile = ({credit}: {credit: WalletCredit}) => {
    const t = useT(walletCreditsCatalog)
    const kind = creditKind(credit.credit_kind, t)
    const color = analyticsColor(kind.color)
    const left = credit.amount_musd > 0 ? (credit.remaining_musd / credit.amount_musd) * 100 : 0
    return (
        <section className="bg-muted box-border flex h-35 min-w-0 flex-col rounded-lg px-3 py-3">
            <span className="text-muted-foreground flex items-center gap-2 truncate text-label">
                <span className="size-2 shrink-0 rounded-xs" style={{background: color}} />
                {kind.label}
            </span>
            <span className="mt-auto flex min-w-0 items-baseline gap-1.5">
                <span className="text-foreground truncate text-heading font-medium tabular-nums">
                    <AnimatedNumber value={formatCredits(credit.remaining_musd)} />
                </span>
                <span className="text-muted-foreground truncate text-meta tabular-nums">
                    {t("wallet.credits.ofAmount", {amount: formatCredits(credit.amount_musd)})}
                </span>
            </span>
            <span className="bg-secondary my-1.5 block h-1 overflow-hidden rounded-xs">
                <span
                    className="block h-full rounded-xs"
                    style={{width: `${Math.min(100, left)}%`, background: color}}
                />
            </span>
            <span className="text-muted-foreground truncate text-label">
                {kind.lasts(credit.end_time)}
            </span>
        </section>
    )
}

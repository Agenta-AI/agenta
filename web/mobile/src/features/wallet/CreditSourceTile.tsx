import {analyticsColor} from "@agenta/observability-ui/analytics"

import {AnimatedNumber} from "@/components/AnimatedNumber"

import type {WalletCredit} from "./walletApi"
import {creditKind, formatCredits} from "./walletFormat"

/** One credit the balance draws on: what it is, what is left of it, and when it runs out. */
export const CreditSourceTile = ({credit}: {credit: WalletCredit}) => {
    const kind = creditKind(credit.credit_kind)
    const color = analyticsColor(kind.color)
    const left = credit.amount_musd > 0 ? (credit.remaining_musd / credit.amount_musd) * 100 : 0
    return (
        <section className="bg-muted box-border flex h-[140px] min-w-0 flex-col rounded-xl px-3.5 py-3.5">
            <span className="text-muted-foreground flex items-center gap-2 truncate text-[13px]">
                <span className="size-2 shrink-0 rounded-full" style={{background: color}} />
                {kind.label}
            </span>
            <span className="mt-auto flex min-w-0 items-baseline gap-1.5">
                <span className="text-foreground truncate text-xl font-medium tabular-nums leading-[26px]">
                    <AnimatedNumber value={formatCredits(credit.remaining_musd)} />
                </span>
                <span className="text-muted-foreground truncate text-xs tabular-nums">
                    of {formatCredits(credit.amount_musd)}
                </span>
            </span>
            <span className="bg-accent my-1.5 block h-[3px] overflow-hidden rounded-full">
                <span
                    className="block h-full rounded-full"
                    style={{width: `${Math.min(100, left)}%`, background: color}}
                />
            </span>
            <span className="text-muted-foreground truncate text-[13px]">
                {kind.lasts(credit.end_time)}
            </span>
        </section>
    )
}

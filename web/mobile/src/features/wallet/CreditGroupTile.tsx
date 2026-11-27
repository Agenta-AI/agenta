import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import walletCreditsCatalog from "@agenta/i18n/catalogs/wallet.credits"
import {analyticsColor} from "@agenta/observability-ui/analytics"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

import {AnimatedNumber} from "@/components/AnimatedNumber"

import type {WalletCredit} from "./walletApi"
import {creditKind, formatCredits, formatDate} from "./walletFormat"

const byExpiry = (a: WalletCredit, b: WalletCredit) =>
    (a.end_time ?? "9999").localeCompare(b.end_time ?? "9999")

/** Several one-time credits folded into one tile; the popover lists each by expiry. */
export const CreditGroupTile = ({
    label,
    icon,
    credits,
}: {
    label: string
    icon: ReactNode
    credits: WalletCredit[]
}) => {
    const t = useT(walletCreditsCatalog)
    const sorted = [...credits].sort(byExpiry)
    const remaining = sorted.reduce((total, credit) => total + credit.remaining_musd, 0)
    const amount = sorted.reduce((total, credit) => total + credit.amount_musd, 0)
    const next = sorted.find((credit) => credit.end_time)?.end_time

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="bg-muted hover:bg-accent box-border flex h-35 min-w-0 cursor-pointer flex-col rounded-lg border-0 px-3 py-3 text-left transition-colors focus-ring"
                >
                    <span className="text-muted-foreground flex w-full items-center gap-2 text-label">
                        {icon}
                        <span className="truncate">{label}</span>
                        <span className="ml-auto inline-flex items-center gap-1 text-meta tabular-nums">
                            {sorted.length}
                            <CaretDown size={12} />
                        </span>
                    </span>
                    <span className="mt-auto flex min-w-0 items-baseline gap-1.5">
                        <span className="text-foreground truncate text-heading font-medium tabular-nums">
                            <AnimatedNumber value={formatCredits(remaining)} />
                        </span>
                        <span className="text-muted-foreground truncate text-meta tabular-nums">
                            {t("wallet.credits.ofAmount", {amount: formatCredits(amount)})}
                        </span>
                    </span>
                    <span className="bg-secondary my-1.5 flex h-1 w-full gap-px overflow-hidden rounded-xs">
                        {sorted.map((credit) => (
                            <span
                                key={credit.id}
                                className="h-full"
                                style={{
                                    flex: credit.remaining_musd,
                                    background: analyticsColor(
                                        creditKind(credit.credit_kind, t).color,
                                    ),
                                }}
                            />
                        ))}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 w-full text-label">
                        {next
                            ? t("wallet.credits.nextExpires", {date: formatDate(next)})
                            : t("wallet.credits.noExpiry")}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
                <div className="text-muted-foreground px-2 pb-1 pt-1.5 text-meta">
                    {t("wallet.credits.byExpiry", {label})}
                </div>
                {sorted.map((credit) => {
                    const kind = creditKind(credit.credit_kind, t)
                    return (
                        <div
                            key={credit.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-label"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span
                                    className="size-2 shrink-0 rounded-xs"
                                    style={{background: analyticsColor(kind.color)}}
                                />
                                <span className="truncate">{kind.label}</span>
                            </span>
                            <span className="tabular-nums">
                                {formatCredits(credit.remaining_musd)}
                                <span className="text-muted-foreground">
                                    {" "}
                                    / {formatCredits(credit.amount_musd)}
                                </span>
                            </span>
                            <span className="text-muted-foreground col-span-2 pl-4 text-meta">
                                {kind.lasts(credit.end_time)}
                            </span>
                        </div>
                    )
                })}
            </PopoverContent>
        </Popover>
    )
}

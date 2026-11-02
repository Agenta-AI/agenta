import type {ReactNode} from "react"

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
    const sorted = [...credits].sort(byExpiry)
    const remaining = sorted.reduce((total, credit) => total + credit.remaining_musd, 0)
    const amount = sorted.reduce((total, credit) => total + credit.amount_musd, 0)
    const next = sorted.find((credit) => credit.end_time)?.end_time

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="bg-muted hover:bg-accent box-border flex h-[140px] min-w-0 cursor-pointer flex-col rounded-xl border-0 px-3.5 py-3.5 text-left transition-colors"
                >
                    <span className="text-muted-foreground flex w-full items-center gap-2 text-[13px]">
                        {icon}
                        <span className="truncate">{label}</span>
                        <span className="ml-auto inline-flex items-center gap-0.5 text-xs tabular-nums">
                            {sorted.length}
                            <CaretDown size={10} />
                        </span>
                    </span>
                    <span className="mt-auto flex min-w-0 items-baseline gap-1.5">
                        <span className="text-foreground truncate text-xl font-medium tabular-nums leading-[26px]">
                            <AnimatedNumber value={formatCredits(remaining)} />
                        </span>
                        <span className="text-muted-foreground truncate text-xs tabular-nums">
                            of {formatCredits(amount)}
                        </span>
                    </span>
                    <span className="bg-accent my-1.5 flex h-[3px] w-full gap-px overflow-hidden rounded-full">
                        {sorted.map((credit) => (
                            <span
                                key={credit.id}
                                className="h-full"
                                style={{
                                    flex: credit.remaining_musd,
                                    background: analyticsColor(
                                        creditKind(credit.credit_kind).color,
                                    ),
                                }}
                            />
                        ))}
                    </span>
                    <span className="text-muted-foreground line-clamp-2 w-full text-[13px] leading-[18px]">
                        {next ? `Next expires ${formatDate(next)}` : "No expiry"}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[300px] p-1.5">
                <div className="text-muted-foreground px-2 pb-1 pt-1.5 text-xs">
                    {label}, by expiry
                </div>
                {sorted.map((credit) => {
                    const kind = creditKind(credit.credit_kind)
                    return (
                        <div
                            key={credit.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-[13px]"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span
                                    className="size-2 shrink-0 rounded-full"
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
                            <span className="text-muted-foreground col-span-2 pl-4 text-xs">
                                {kind.lasts(credit.end_time)}
                            </span>
                        </div>
                    )
                })}
            </PopoverContent>
        </Popover>
    )
}

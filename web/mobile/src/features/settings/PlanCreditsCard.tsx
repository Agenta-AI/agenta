import {AnalyticsCard, analyticsColor} from "@agenta/observability-ui/analytics"

import {AnimatedNumber} from "@/components/AnimatedNumber"

import type {WalletCredit} from "../wallet/walletApi"
import {formatCredits, formatDate} from "../wallet/walletFormat"

/** The plan's monthly credits against the grant, or the whole balance where there is no grant. */
export const PlanCreditsCard = ({
    monthly,
    balanceMusd,
}: {
    monthly: WalletCredit | null
    balanceMusd: number
}) => {
    const color = analyticsColor(monthly ? "series4" : "series1")
    const used = monthly ? (monthly.remaining_musd / monthly.amount_musd) * 100 : null
    return (
        <AnalyticsCard
            className="min-h-[176px]"
            title={
                <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{background: color}} />
                    {monthly ? "Monthly credits left" : "Credits left"}
                </span>
            }
            value={
                <span className="text-[30px] font-semibold tabular-nums leading-9">
                    <AnimatedNumber
                        value={formatCredits(monthly ? monthly.remaining_musd : balanceMusd)}
                    />
                </span>
            }
            caption={monthly ? `of ${formatCredits(monthly.amount_musd)}` : "credits"}
            note={
                monthly
                    ? `${monthly.end_time ? `Resets ${formatDate(monthly.end_time)} · ` : ""}total balance ${formatCredits(balanceMusd)} credits`
                    : "Every credit your organization can spend right now."
            }
        >
            {used === null ? null : (
                <span className="bg-accent block h-1.5 overflow-hidden rounded-full">
                    <span
                        className="block h-full rounded-full"
                        style={{width: `${Math.min(100, used)}%`, background: color}}
                    />
                </span>
            )}
        </AnalyticsCard>
    )
}

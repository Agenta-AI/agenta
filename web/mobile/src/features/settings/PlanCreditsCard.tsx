import {useT} from "@agenta/i18n"
import billingPlanCreditsCardCatalog from "@agenta/i18n/catalogs/billing.planCreditsCard"
import {analyticsColor} from "@agenta/observability-ui/analytics"

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
    const t = useT(billingPlanCreditsCardCatalog)
    const color = analyticsColor(monthly ? "series4" : "series1")
    const left = monthly ? (monthly.remaining_musd / monthly.amount_musd) * 100 : null
    return (
        <section className="bg-muted box-border flex min-h-[176px] min-w-0 flex-col rounded-2xl px-5 py-[18px]">
            <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <span className="size-2 shrink-0 rounded-full" style={{background: color}} />
                {monthly
                    ? t("billing.planCreditsCard.monthlyCreditsLeft")
                    : t("billing.planCreditsCard.creditsLeft")}
            </span>
            <span className="mt-auto flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                <span className="text-[30px] font-semibold leading-9 tracking-[-0.02em]">
                    <AnimatedNumber
                        value={formatCredits(monthly ? monthly.remaining_musd : balanceMusd)}
                    />
                </span>
                <span className="text-muted-foreground tabular-nums">
                    {monthly
                        ? t("billing.planCreditsCard.ofTotal", {
                              total: formatCredits(monthly.amount_musd),
                          })
                        : t("billing.planCreditsCard.credits")}
                </span>
            </span>
            {left === null ? null : (
                <span className="bg-accent mb-2 mt-2.5 block h-1.5 overflow-hidden rounded-full">
                    <span
                        className="block h-full rounded-full"
                        style={{width: `${Math.min(100, left)}%`, background: color}}
                    />
                </span>
            )}
            <span className="text-muted-foreground text-[13px]">
                {monthly
                    ? monthly.end_time
                        ? t("billing.planCreditsCard.resetsAndBalance", {
                              date: formatDate(monthly.end_time),
                              balance: formatCredits(balanceMusd),
                          })
                        : t("billing.planCreditsCard.totalBalance", {
                              balance: formatCredits(balanceMusd),
                          })
                    : t("billing.planCreditsCard.everyCredit")}
            </span>
        </section>
    )
}

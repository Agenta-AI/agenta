import {sum} from "@agenta/observability/analytics"
import {ANALYTICS_COLOR_CSS} from "@agenta/observability-ui/analytics"
import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {CreditHistoryTable} from "./CreditHistoryTable"
import {CreditsBuyAction} from "./CreditsBuyAction"
import {CreditsHero} from "./CreditsHero"
import {CreditsUsageSection} from "./CreditsUsageSection"
import {CreditsPageSkeleton} from "./states/CreditsPageSkeleton"
import {WalletUsageError} from "./states/WalletUsageError"
import {useWalletSummary} from "./useWalletSummary"
import {fetchWalletUsage} from "./walletApi"

const PACE_DAYS = 30

/** What an enforced wallet has left, where it went, and how to add more. */
export const CreditsTab = ({projectId}: {projectId: string}) => {
    const router = useRouter()
    const summary = useWalletSummary(projectId)
    const enforced = summary.data?.mode === "enforce"
    // Same key as the usage chart's default range, so the page reads it once.
    const pace = useQuery({
        queryKey: ["wallet", "credits-usage", projectId, PACE_DAYS],
        queryFn: () =>
            fetchWalletUsage(projectId, {
                start: new Date(Date.now() - PACE_DAYS * 86_400_000).toISOString(),
            }),
        enabled: Boolean(projectId) && enforced,
        retry: false,
    })

    const goTab = (tab: string, extra: Record<string, string> = {}) =>
        void router.replace({query: {...router.query, tab, ...extra}}, undefined, {shallow: true})

    if (summary.isPending) return <CreditsPageSkeleton />
    if (summary.isError) return <WalletUsageError onRetry={() => void summary.refetch()} />
    if (!enforced)
        return (
            <p className="text-muted-foreground m-0 text-[13px]">
                Credits are not in use for this organization.
            </p>
        )

    const dailyMusd = pace.data
        ? sum(pace.data.days.map((day) => day.amount_musd)) / PACE_DAYS
        : null
    const billing = isBillingEnabled()

    return (
        <div className="flex flex-col gap-11">
            <style>{ANALYTICS_COLOR_CSS}</style>
            {billing ? (
                <CreditsBuyAction
                    projectId={projectId}
                    onUpgrade={() => goTab("billing", {plans: "1"})}
                />
            ) : null}
            <CreditsHero wallet={summary.data} dailyMusd={dailyMusd} />
            <CreditsUsageSection projectId={projectId} />
            <CreditHistoryTable credits={summary.data.credits} showInvoices={billing} />
        </div>
    )
}

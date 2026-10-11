import {useEffect, useState} from "react"

import {ANALYTICS_COLOR_CSS} from "@agenta/observability-ui/analytics"
import {
    fetchBillingUsage,
    useBillingCatalog,
    useBillingSubscription,
    useTopUpOffer,
} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {Button} from "@agenta/ui/ui"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {CreditTopUps} from "../wallet/CreditTopUps"
import {useWalletSummary} from "../wallet/useWalletSummary"
import {dailyCredit, monthlyCredit} from "../wallet/walletCredits"
import {formatCredits} from "../wallet/walletFormat"

import {BillingPaymentsSection} from "./BillingPaymentsSection"
import {CancelSubscriptionSheet} from "./CancelSubscriptionSheet"
import {PlanChooserSheet} from "./PlanChooserSheet"
import {PlanCreditsCard} from "./PlanCreditsCard"
import {planLimits} from "./planLimits"
import {PlanStatTile} from "./PlanStatTile"
import {PlanSummaryCard} from "./PlanSummaryCard"
import type {SettingsTabProps} from "./settingsTabProps"
import {BillingLoadError} from "./states/BillingLoadError"
import {BillingPageSkeleton} from "./states/BillingPageSkeleton"
import {useBillingPortal} from "./useBillingPortal"

/** Plan & billing: the plan and what it grants, its limits, and where payments live. */
export const BillingTab = ({projectId}: SettingsTabProps) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const billingEnabled = isBillingEnabled()

    const [planChooserOpen, setPlanChooserOpen] = useState(false)
    const [cancelOpen, setCancelOpen] = useState(false)
    const portal = useBillingPortal()

    const usage = useQuery({
        queryKey: ["billing", "usage", projectId],
        queryFn: () => fetchBillingUsage(projectId),
        enabled: Boolean(projectId),
    })
    const subscription = useBillingSubscription({projectId})
    const catalog = useBillingCatalog({
        projectId,
        currentPlan: subscription.data?.plan,
        enabled: billingEnabled,
    })
    const wallet = useWalletSummary(projectId, {poll: false})
    const topUps = useTopUpOffer({projectId, enabled: billingEnabled})

    // "See plans" elsewhere lands here with the chooser open.
    useEffect(() => {
        if (router.query.plans !== "1" || !billingEnabled) return
        setPlanChooserOpen(true)
        const {plans: _plans, ...rest} = router.query
        void router.replace({pathname: router.pathname, query: rest}, undefined, {shallow: true})
    }, [router, billingEnabled])

    // A plan change moves the wallet's grants too.
    const refresh = () => {
        void queryClient.invalidateQueries({queryKey: ["billing"]})
        void queryClient.invalidateQueries({queryKey: ["wallet"]})
    }

    if (usage.isPending || subscription.isPending) return <BillingPageSkeleton />
    if (usage.isError && subscription.isError)
        return (
            <BillingLoadError
                message="We couldn't load your plan and its limits."
                onRetry={() => {
                    void usage.refetch()
                    void subscription.refetch()
                }}
            />
        )

    const enforced = wallet.data?.mode === "enforce" ? wallet.data : null
    const monthly = enforced ? monthlyCredit(enforced) : null
    const planSlug = subscription.data?.plan
    // Enterprise has no slug, so an unknown plan must not match it.
    const currentPlan = planSlug ? catalog.plans.find((plan) => plan.plan === planSlug) : undefined
    const showPlanCard = !subscription.isError && (billingEnabled || Boolean(subscription.data))
    const daily = enforced ? dailyCredit(enforced) : null
    const limits = planLimits(usage.data)
    const viewMembers = () =>
        void router.replace({query: {...router.query, tab: "workspace"}}, undefined, {
            shallow: true,
        })

    return (
        <div className="flex flex-col gap-10">
            <style>{ANALYTICS_COLOR_CSS}</style>
            <div className="flex flex-col gap-2.5">
                {subscription.isError ? (
                    <BillingLoadError
                        message="We couldn't load your plan."
                        onRetry={() => void subscription.refetch()}
                    />
                ) : null}
                {usage.isError ? (
                    <BillingLoadError
                        message="We couldn't load your plan limits."
                        onRetry={() => void usage.refetch()}
                    />
                ) : null}
                {showPlanCard || enforced ? (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
                        {showPlanCard ? (
                            <PlanSummaryCard
                                subscription={subscription.data}
                                plan={currentPlan}
                                monthlyCreditsMusd={monthly?.amount_musd ?? null}
                                isOnFreePlan={catalog.isOnFreePlan}
                                isCustomPlan={catalog.isCustomPlan}
                                onChangePlan={
                                    billingEnabled ? () => setPlanChooserOpen(true) : undefined
                                }
                                onCancel={billingEnabled ? () => setCancelOpen(true) : undefined}
                            />
                        ) : null}
                        {enforced ? (
                            <PlanCreditsCard
                                monthly={monthly}
                                balanceMusd={Math.max(0, enforced.spendable_musd ?? 0)}
                            />
                        ) : null}
                    </div>
                ) : null}
                {/* Pricing counts only credits, so the trace and evaluation quotas are not listed. */}
                {daily || limits.length ? (
                    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                        {daily ? (
                            <PlanStatTile
                                label="Daily free credits"
                                value={formatCredits(daily.amount_musd)}
                                note="Resets at midnight UTC"
                            />
                        ) : null}
                        {limits.map((limit) => (
                            <PlanStatTile
                                key={limit.key}
                                label={limit.label}
                                value={limit.value}
                                note={limit.note}
                                action={
                                    limit.key === "users" ? (
                                        <Button
                                            size="xs"
                                            variant="link"
                                            className="h-auto px-0"
                                            onClick={viewMembers}
                                        >
                                            View
                                        </Button>
                                    ) : null
                                }
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            {/* Only where the plan can buy packs; the section itself asks the API. */}
            {billingEnabled && topUps.data?.status === "available" ? (
                <CreditTopUps
                    projectId={projectId}
                    onUpgrade={() => setPlanChooserOpen(true)}
                    framed
                />
            ) : null}

            {billingEnabled ? (
                <BillingPaymentsSection
                    onOpenPortal={portal.open}
                    opening={portal.opening}
                    error={portal.error}
                />
            ) : null}

            <PlanChooserSheet
                open={planChooserOpen}
                onOpenChange={setPlanChooserOpen}
                projectId={projectId}
                plans={catalog.plans}
                loading={catalog.isLoading}
                currentPlan={subscription.data?.plan}
                freePlanSlug={catalog.freePlanSlug}
                isCurrentPlanCustom={catalog.isCustomPlan}
                onCancelSubscription={() => setCancelOpen(true)}
                onChanged={refresh}
            />
            <CancelSubscriptionSheet
                open={cancelOpen}
                onOpenChange={setCancelOpen}
                projectId={projectId}
                onChanged={refresh}
            />
        </div>
    )
}

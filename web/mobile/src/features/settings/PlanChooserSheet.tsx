import {useState} from "react"

import {
    checkoutBillingSubscription,
    switchBillingPlan,
    type BillingPlanOption,
} from "@agenta/settings-ui"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    SkeletonBlock,
} from "@agenta/ui/ui"

import {sharedFeatures} from "./planCatalog"
import {PlanOptionCard} from "./PlanOptionCard"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    projectId: string
    plans: BillingPlanOption[]
    loading?: boolean
    currentPlan?: string | null
    freePlanSlug?: string | null
    isCurrentPlanCustom?: boolean
    /** Moving down to the free tier is a cancellation, which has its own modal. */
    onCancelSubscription: () => void
    onChanged: () => void
}

/**
 * The plan chooser as a modal. Picking a paid plan from the free tier hands off to
 * Stripe Checkout in a new tab; paid → paid switches server-side and closes.
 */
export const PlanChooserSheet = ({
    open,
    onOpenChange,
    projectId,
    plans,
    loading,
    currentPlan,
    freePlanSlug,
    isCurrentPlanCustom,
    onCancelSubscription,
    onChanged,
}: Props) => {
    const [pendingPlan, setPendingPlan] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const isOnFreePlan = Boolean(currentPlan && freePlanSlug && currentPlan === freePlanSlug)

    const selectPlan = async (plan: BillingPlanOption) => {
        setError(null)

        if (freePlanSlug && plan.plan === freePlanSlug && !isOnFreePlan) {
            onOpenChange(false)
            onCancelSubscription()
            return
        }

        setPendingPlan(plan.plan)
        try {
            if (!currentPlan || isOnFreePlan) {
                const checkoutUrl = await checkoutBillingSubscription({
                    plan: plan.plan,
                    successUrl: `${window.location.origin}${window.location.pathname}?tab=billing`,
                })
                if (checkoutUrl) window.open(checkoutUrl, "_blank")
            } else {
                await switchBillingPlan({plan: plan.plan, projectId})
            }
            onChanged()
            onOpenChange(false)
        } catch {
            setError("We couldn't change your plan. Try again, or contact support if it persists.")
        } finally {
            setPendingPlan(null)
        }
    }

    const included = sharedFeatures(plans)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* On a desktop the cards keep their buttons in view and scroll their lists instead. */}
            <DialogContent className="max-w-[1040px] lg:overflow-hidden">
                <DialogHeader className="pr-6">
                    <DialogTitle>Plans</DialogTitle>
                    <DialogDescription>
                        Every plan runs on credits. Pick how many you get each month.
                    </DialogDescription>
                </DialogHeader>
                {error ? <p className="text-destructive m-0 text-sm">{error}</p> : null}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] lg:grid-rows-[minmax(0,1fr)]">
                    {loading
                        ? Array.from({length: 3}, (_, index) => (
                              <SkeletonBlock key={index} className="h-[360px] rounded-[14px]" />
                          ))
                        : plans.map((plan) => (
                              <PlanOptionCard
                                  key={plan.plan ?? plan.title}
                                  plan={plan}
                                  isCurrent={Boolean(plan.plan) && plan.plan === currentPlan}
                                  isFree={Boolean(freePlanSlug) && plan.plan === freePlanSlug}
                                  isCurrentPlanCustom={Boolean(isCurrentPlanCustom)}
                                  pending={pendingPlan === plan.plan}
                                  busy={Boolean(pendingPlan) && pendingPlan !== plan.plan}
                                  onSelect={() => void selectPlan(plan)}
                              />
                          ))}
                </div>
                {included.length ? (
                    <div className="bg-muted flex shrink-0 flex-col gap-2 rounded-xl px-4 py-3.5">
                        <span className="text-[13px] font-medium">Included on every plan</span>
                        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                            {included.map((feature) => (
                                <li
                                    key={feature}
                                    className="bg-background border-border rounded-full border border-solid px-2.5 text-xs leading-[22px]"
                                >
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

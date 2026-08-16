import {useState} from "react"

import {
    checkoutBillingSubscription,
    PricingPlans,
    reserveTab,
    switchBillingPlan,
    type BillingPlanOption,
} from "@agenta/settings-ui"

import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@/components/ui/sheet"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    projectId: string
    plans: BillingPlanOption[]
    loading?: boolean
    currentPlan?: string | null
    freePlanSlug?: string | null
    isCurrentPlanCustom?: boolean
    /** Moving down to the free tier is a cancellation, which has its own sheet. */
    onCancelSubscription: () => void
    onChanged: () => void
}

/**
 * The plan chooser as a bottom sheet. Picking a paid plan from the free tier hands off to
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

        // Reserved inside the tap — by the time Stripe answers, the gesture is gone and a
        // mobile browser blocks the popup outright.
        const opensCheckout = !currentPlan || isOnFreePlan
        const tab = opensCheckout ? reserveTab() : null

        setPendingPlan(plan.plan)
        try {
            if (opensCheckout) {
                const checkoutUrl = await checkoutBillingSubscription({
                    plan: plan.plan,
                    successUrl: `${window.location.origin}${window.location.pathname}?tab=billing`,
                })
                if (checkoutUrl) tab?.navigate(checkoutUrl)
                else tab?.release()
            } else {
                await switchBillingPlan({plan: plan.plan, projectId})
            }
            onChanged()
            onOpenChange(false)
        } catch {
            tab?.release()
            setError("We couldn't change your plan. Try again, or contact support if it persists.")
        } finally {
            setPendingPlan(null)
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>Plans</SheetTitle>
                    <SheetDescription>Choose the plan for this organization.</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">
                    {error ? <p className="m-0 pb-2 text-sm text-colorError">{error}</p> : null}
                    <PricingPlans
                        plans={plans}
                        loading={loading}
                        currentPlan={currentPlan}
                        freePlanSlug={freePlanSlug}
                        isCurrentPlanCustom={isCurrentPlanCustom}
                        pendingPlan={pendingPlan}
                        onSelectPlan={(plan) => void selectPlan(plan)}
                    />
                </div>
            </SheetContent>
        </Sheet>
    )
}

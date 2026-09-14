import {useState} from "react"

import {
    checkoutBillingSubscription,
    PricingPlans,
    switchBillingPlan,
    type BillingPlanOption,
} from "@agenta/settings-ui"
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@agenta/ui/ui"

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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Plans</DialogTitle>
                    <DialogDescription>Choose the plan for this organization.</DialogDescription>
                </DialogHeader>
                <div>
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
            </DialogContent>
        </Dialog>
    )
}

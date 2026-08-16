/**
 * The pricing dialog. The plan grid is `@agenta/settings-ui`'s; picking a plan is this
 * host's — checkout, switch and the route through cancellation all land here.
 */

import {useCallback, useState} from "react"

import {PricingPlans, type BillingPlanOption} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
import {EnhancedModal, type EnhancedModalProps} from "@agenta/ui/components/modal"
import {Button} from "@agenta/ui/ui"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {
    checkoutNewSubscription,
    switchSubscription,
    usePricingPlans,
    useSubscriptionData,
    useUsageData,
} from "@/oss/services/billing"
import {currentCatalogEntryAtom, freePlanSlugAtom, isOnFreePlanAtom} from "@/oss/state/access/atoms"

export interface PricingModalProps extends EnhancedModalProps {
    onCancelSubscription: () => void
}

const PricingModalTitle = () => (
    <div className="flex w-full items-center justify-between">
        <span className="text-base font-semibold">Plans</span>
        <Button variant="outline" className="mr-6" asChild>
            <a href="https://agenta.ai/pricing" target="_blank" rel="noreferrer">
                View comparison
            </a>
        </Button>
    </div>
)

const PricingModal = ({onCancelSubscription, ...props}: PricingModalProps) => {
    const {plans, isLoadingPlan} = usePricingPlans()
    const {subscription, mutateSubscription} = useSubscriptionData()
    const {mutateUsage} = useUsageData()
    const {projectURL} = useURL()
    const freePlanSlug = useAtomValue(freePlanSlugAtom)
    const isOnFreePlan = useAtomValue(isOnFreePlanAtom)
    const currentCatalogEntry = useAtomValue(currentCatalogEntryAtom)

    const [pendingPlan, setPendingPlan] = useState<string | null>(null)

    const onSelectPlan = useCallback(
        async (plan: BillingPlanOption) => {
            try {
                setPendingPlan(plan.plan)
                // 1. If switching to the free plan from a paid plan, route through the cancel flow.
                // 2. If currently on the free plan (or no subscription), start a fresh checkout.
                // 3. Otherwise (paid → paid), switch subscription server-side.
                const isSwitchingToFree = !!freePlanSlug && plan.plan === freePlanSlug

                if (isSwitchingToFree && !isOnFreePlan) {
                    onCancelSubscription()
                    return
                } else if (!subscription || isOnFreePlan) {
                    const data = await checkoutNewSubscription({
                        plan: plan.plan,
                        success_url: `${getEnv("NEXT_PUBLIC_AGENTA_WEB_URL")}${projectURL || ""}/settings?tab=billing`,
                    })

                    window.open(data.data.checkout_url, "_blank")
                } else {
                    await switchSubscription({plan: plan.plan})
                }

                setTimeout(() => {
                    mutateSubscription()
                    mutateUsage()
                    props.onCancel?.({} as any)
                }, 500)
            } catch (error) {
                message.error(
                    "An error occurred while processing the checkout. Please try again later or contact support if the issue persists.",
                )
            } finally {
                setPendingPlan(null)
            }
        },
        [
            onCancelSubscription,
            mutateSubscription,
            mutateUsage,
            subscription,
            isOnFreePlan,
            freePlanSlug,
            projectURL,
            props.onCancel,
        ],
    )

    return (
        <EnhancedModal
            className={clsx('[&_[data-slot="dialog-close-x"]]:!top-[19px]', props.className)}
            width={1200}
            title={<PricingModalTitle />}
            footer={null}
            {...props}
        >
            <PricingPlans
                plans={plans}
                loading={isLoadingPlan}
                currentPlan={subscription?.plan}
                freePlanSlug={freePlanSlug}
                isCurrentPlanCustom={currentCatalogEntry?.type === "custom"}
                pendingPlan={pendingPlan}
                onSelectPlan={onSelectPlan}
            />
        </EnhancedModal>
    )
}

export default PricingModal

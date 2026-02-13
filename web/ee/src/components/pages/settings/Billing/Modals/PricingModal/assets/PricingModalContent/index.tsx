import {useCallback, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Spin, Typography} from "antd"

import useURL from "@/oss/hooks/useURL"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {Plan} from "@/oss/lib/Types"
import {
    checkoutNewSubscription,
    switchSubscription,
    usePricingPlans,
    useSubscriptionData,
    useUsageData,
} from "@/oss/services/billing"
import {BillingPlan} from "@/oss/services/billing/types"

import PricingCard from "../PricingCard"
import {PricingModalContentProps} from "../types"

const PricingModalContent = ({onCancelSubscription, onCloseModal}: PricingModalContentProps) => {
    const {plans, isLoadingPlan} = usePricingPlans()
    const {subscription, mutateSubscription} = useSubscriptionData()
    const {mutateUsage} = useUsageData()
    const {projectURL} = useURL()

    const [isLoading, setIsLoading] = useState<string | null>(null)

    const onOptionClick = useCallback(
        async (plan: BillingPlan) => {
            try {
                setIsLoading(plan.plan)
                // 1. if the selected plan is cloud_v0_hobby and the subscription-plan is not then we trigger the cancel endpoint
                // 2. subscription-pan is cloud_v0_hobby then we trigger the checkout endpoint
                // 3. if the user can custom plan like cloud_v0_business then we trigger the switch endpoint

                if (plan.plan === Plan.Hobby && subscription?.plan !== Plan.Hobby) {
                    onCancelSubscription()
                    return
                } else if (!subscription || subscription?.plan === Plan.Hobby) {
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
                    onCloseModal()
                }, 500)
            } catch (error) {
                message.error(
                    "An error occurred while processing the checkout. Please try again later or contact support if the issue persists.",
                )
            } finally {
                setIsLoading(null)
            }
        },
        [
            onCancelSubscription,
            checkoutNewSubscription,
            switchSubscription,
            mutateSubscription,
            mutateUsage,
            projectURL,
        ],
    )

    if (isLoadingPlan) {
        return (
            <div className="w-full h-[400px] flex items-center justify-center">
                <Spin spinning={isLoadingPlan}></Spin>
            </div>
        )
    }

    return (
        <section className="mx-auto flex flex-col gap-2 mt-4">
            <Typography.Text className=" font-medium">Choose your plan</Typography.Text>
            <div className="flex flex-col md:flex-row gap-4">
                {plans?.map((plan) => (
                    <PricingCard
                        key={plan.title}
                        plan={plan}
                        currentPlan={subscription}
                        onOptionClick={onOptionClick}
                        isLoading={isLoading}
                    />
                ))}
            </div>
        </section>
    )
}

export default PricingModalContent

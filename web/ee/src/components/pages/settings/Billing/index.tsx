import {useCallback, useState, useEffect} from "react"

import {Button, message, Spin, Typography} from "antd"
import dayjs from "dayjs"
import {useRouter} from "next/router"

import {Plan} from "@/oss/lib/Types"
import {
    editSubscriptionInfo,
    useSubscriptionData,
    useUsageData,
    createTrialContinuationCheckout,
} from "@/oss/services/billing"

import UsageProgressBar from "./assets/UsageProgressBar"
import AutoRenewalCancelModal from "./Modals/AutoRenewalCancelModal"
import PricingModal from "./Modals/PricingModal"
import SubscriptionPlanDetails from "./Modals/PricingModal/assets/SubscriptionPlanDetails"

const {Link} = Typography

const Billing = () => {
    const router = useRouter()
    const [isLoadingOpenBillingPortal, setIsLoadingOpenBillingPortal] = useState(false)
    const [isLoadingContinueWithPro, setIsLoadingContinueWithPro] = useState(false)
    const {subscription, isSubLoading, mutateSubscription} = useSubscriptionData()
    const {usage, isUsageLoading} = useUsageData()
    const [isOpenPricingModal, setIsOpenPricingModal] = useState(false)
    const [isOpenCancelModal, setIsOpenCancelModal] = useState(false)

    const onCancelSubscription = useCallback(() => {
        setIsOpenCancelModal(true)
    }, [])

    const handleOpenBillingPortal = useCallback(async () => {
        try {
            setIsLoadingOpenBillingPortal(true)
            const data = await editSubscriptionInfo()

            window.open(data.data.portal_url, "_blank")
        } catch (error) {
            message.error(
                "We encountered an issue while opening the Stripe portal. Please try again in a few minutes. If the problem persists, contact support.",
            )
        } finally {
            setIsLoadingOpenBillingPortal(false)
        }
    }, [editSubscriptionInfo])

    const handleContinueWithPro = useCallback(async () => {
        try {
            setIsLoadingContinueWithPro(true)
            const successUrl = `${window.location.origin}/settings?tab=billing&trial_upgrade=success`
            const data = await createTrialContinuationCheckout(successUrl)
            
            if (data?.data?.checkout_url) {
                window.location.href = data.data.checkout_url
            } else {
                throw new Error("No checkout URL received")
            }
        } catch (error: any) {
            console.error("Trial continuation error:", error)
            
            // Handle specific error messages from backend
            const errorMessage = error?.response?.data?.message
            if (errorMessage) {
                if (errorMessage.includes("already active")) {
                    message.info("Your subscription is already active! No action needed.")
                } else if (errorMessage.includes("already added")) {
                    message.info("Payment method already added! Your Pro subscription will continue after trial.")
                } else if (errorMessage.includes("already ended")) {
                    message.warning("Your trial has ended. Please upgrade from the pricing options.")
                    setIsOpenPricingModal(true)
                } else {
                    message.error(errorMessage)
                }
            } else {
                message.error("Unable to continue with Pro. Please try again or contact support if the issue persists.")
            }
        } finally {
            setIsLoadingContinueWithPro(false)
        }
    }, [setIsOpenPricingModal])

    const navigateToWorkspaceTab = useCallback(() => {
        router.push("/settings", {query: {tab: "workspace"}})
    }, [router])

    // Check for success/error parameters
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search)
        
        if (urlParams.get('trial_upgrade') === 'success') {
            message.success('Payment method added successfully! Your Pro subscription will continue after the trial.')
            // Clean up URL
            window.history.replaceState({}, '', '/settings?tab=billing')
            // Refresh subscription data
            mutateSubscription()
        } else if (urlParams.get('trial_upgrade') === 'cancelled') {
            message.info('Checkout cancelled. You can try again anytime during your trial.')
            // Clean up URL
            window.history.replaceState({}, '', '/settings?tab=billing')
        }
    }, [mutateSubscription])

    if (isSubLoading || isUsageLoading) {
        return (
            <div className="flex items-center justify-center w-full mt-60">
                <Spin spinning={true}></Spin>
            </div>
        )
    }

    return (
        <section className="flex flex-col gap-4">
            <section className="w-full bg-[#F5F7FA] p-4 rounded-lg">
                <div className="flex flex-col items-start gap-2">
                    <Typography.Text className="text-sm font-medium">Current plan</Typography.Text>
                    <Typography.Text className="text-lg font-bold capitalize">
                        {subscription?.free_trial ? (
                            <div className="flex items-center gap-2">
                                <span>Pro (Free Trial)</span>
                                <span className="text-orange-600 font-normal text-sm">
                                    - {dayjs.unix(subscription.period_end).diff(dayjs(), 'day')} days left
                                </span>
                            </div>
                        ) : (
                            <SubscriptionPlanDetails subscription={subscription} />
                        )}
                    </Typography.Text>
                    {subscription?.plan !== Plan.Hobby && (
                        <Typography.Text className="text-[#586673]">
                            {subscription?.free_trial
                                ? "Trial period will end on "
                                : "Auto renews on "}
                            <span className="text-[#1C2C3D] font-medium">
                                {dayjs.unix(subscription?.period_end).format("MMM D, YYYY")}
                            </span>
                        </Typography.Text>
                    )}

                    {subscription?.plan === Plan.Enterprise ||
                    subscription?.plan === Plan.Business ? (
                        <Typography.Text className="text-[#586673]">
                            For queries regarding your plan,{" "}
                            <a href="https://cal.com/mahmoud-mabrouk-ogzgey/demo" target="_blank">
                                click here to contact us
                            </a>
                        </Typography.Text>
                    ) : subscription?.free_trial ? (
                        <div className="space-y-3">
                            <div className="p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border border-blue-200">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Typography.Text className="text-blue-800 font-medium">
                                            You're on Pro (Trial)
                                        </Typography.Text>
                                        <Typography.Text className="block text-sm text-blue-700">
                                            {dayjs.unix(subscription.period_end).diff(dayjs(), 'day')} days remaining
                                        </Typography.Text>
                                    </div>
                                    <Button 
                                        type="primary" 
                                        onClick={handleContinueWithPro}
                                        loading={isLoadingContinueWithPro}
                                        className="bg-blue-600 hover:bg-blue-700"
                                    >
                                        Continue with Pro
                                    </Button>
                                </div>
                            </div>
                            
                            <Typography.Text className="text-sm text-gray-500">
                                Want to switch plans?{" "}
                                <Button 
                                    type="link" 
                                    size="small" 
                                    onClick={() => setIsOpenPricingModal(true)}
                                    className="p-0 h-auto"
                                >
                                    View options
                                </Button>
                            </Typography.Text>
                        </div>
                    ) : subscription?.plan === Plan.Pro ? (
                        <div className="flex items-center gap-2">
                            <Button type="primary" onClick={() => setIsOpenPricingModal(true)}>
                                Upgrade plan
                            </Button>

                            <Link onClick={() => setIsOpenCancelModal(true)}>
                                Cancel subscription
                            </Link>
                        </div>
                    ) : (
                        <Button type="primary" onClick={() => setIsOpenPricingModal(true)}>
                            Upgrade plan
                        </Button>
                    )}
                </div>
            </section>

            <section className="w-full bg-[#F5F7FA] p-4 rounded-lg flex flex-col items-start gap-4">
                <Typography.Text className="text-sm font-medium">Limits</Typography.Text>

                <div className="w-full grid grid-cols-3 gap-4">
                    {Object.entries(usage)
                        ?.filter(([key]) => key !== "users")
                        ?.map(([key, info]) => {
                            return (
                                <UsageProgressBar
                                    key={`billing-${key}`}
                                    label={key}
                                    used={info.value}
                                    limit={info.limit as number}
                                    strict={info.strict}
                                    isUnlimited={info.limit == null ? true : false}
                                    free={info.free}
                                />
                            )
                        })}
                </div>
            </section>

            <section className="w-full bg-[#F5F7FA] p-4 rounded-lg flex flex-col items-start gap-4">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">Members</Typography.Text>
                    <Button size="small" onClick={navigateToWorkspaceTab}>
                        View members
                    </Button>
                </div>

                <div className="w-full grid grid-cols-3 gap-4">
                    <UsageProgressBar
                        label={"Free"}
                        used={usage?.users?.value}
                        limit={usage?.users?.free as number}
                        strict={usage?.users?.strict}
                        isUnlimited={usage?.users?.limit == null ? true : false}
                        free={usage?.users?.free}
                    />

                    <UsageProgressBar
                        label={"Total"}
                        used={usage?.users?.value}
                        limit={usage?.users?.limit as number}
                        strict={usage?.users?.strict}
                        isUnlimited={usage?.users?.limit == null ? true : false}
                        free={usage?.users?.free}
                    />
                </div>
            </section>

            <section className="w-full bg-[#F5F7FA] p-4 rounded-lg flex flex-col items-start gap-2">
                <Typography.Text className="text-sm font-medium">
                    Billing information
                </Typography.Text>

                <Button onClick={handleOpenBillingPortal} loading={isLoadingOpenBillingPortal}>
                    Open billing portal
                </Button>
            </section>

            <AutoRenewalCancelModal
                open={isOpenCancelModal}
                onCancel={() => setIsOpenCancelModal(false)}
            />
            <PricingModal
                open={isOpenPricingModal}
                onCancel={() => setIsOpenPricingModal(false)}
                onCancelSubscription={onCancelSubscription}
            />
        </section>
    )
}

export default Billing

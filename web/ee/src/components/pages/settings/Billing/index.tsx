import {useCallback, useEffect, useState} from "react"

import {Button, Spin, Typography} from "antd"
import dayjs from "dayjs"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import useURL from "@/oss/hooks/useURL"
import {Plan} from "@/oss/lib/Types"
import {editSubscriptionInfo, useSubscriptionData, useUsageData} from "@/oss/services/billing"

import UsageProgressBar from "./assets/UsageProgressBar"
import AutoRenewalCancelModal from "./Modals/AutoRenewalCancelModal"
import PricingModal from "./Modals/PricingModal"
import SubscriptionPlanDetails from "./Modals/PricingModal/assets/SubscriptionPlanDetails"

const {Link} = Typography

const Billing = () => {
    const router = useRouter()
    const {projectURL} = useURL()
    const [isLoadingOpenBillingPortal, setIsLoadingOpenBillingPortal] = useState(false)
    const {subscription, isSubLoading} = useSubscriptionData()
    const {usage, isUsageLoading} = useUsageData()
    const [isOpenPricingModal, setIsOpenPricingModal] = useState(false)
    const [isOpenCancelModal, setIsOpenCancelModal] = useState(false)

    // Open pricing modal if 'upgrade=true' query param is present
    useEffect(() => {
        if (router.query.upgrade === "true") {
            setIsOpenPricingModal(true)
            // Remove the query param to clean up the URL
            const {upgrade, ...restQuery} = router.query
            router.replace(
                {
                    pathname: router.pathname,
                    query: restQuery,
                },
                undefined,
                {shallow: true},
            )
        }
    }, [router.query.upgrade])

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

    const navigateToWorkspaceTab = useCallback(() => {
        router.push(`${projectURL}/settings`, {query: {tab: "workspace"}})
    }, [router, projectURL])

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
                        <SubscriptionPlanDetails subscription={subscription} />
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

                    {subscription?.plan === Plan.Enterprise ? (
                        <Typography.Text className="text-[#586673]">
                            For queries regarding your plan,{" "}
                            <a href="https://cal.com/mahmoud-mabrouk-ogzgey/demo" target="_blank">
                                click here to contact us
                            </a>
                        </Typography.Text>
                    ) : subscription?.plan === Plan.Pro || subscription?.plan === Plan.Business ? (
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
                        ?.filter(([key]) => key !== "users" && key !== "applications")
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

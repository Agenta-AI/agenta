/**
 * Usage & Billing — EE binding.
 *
 * The page itself is `@agenta/settings-ui`'s. This file owns what is this host's: the
 * subscription and usage queries, the Stripe round-trip (returning from checkout, the
 * `?upgrade=true` deep link), the portal call, and the two dialogs.
 */

import {useCallback, useEffect, useState} from "react"

import {BillingPage} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {isBillingEnabled} from "@/oss/lib/helpers/isEE"
import {editSubscriptionInfo, useSubscriptionData, useUsageData} from "@/oss/services/billing"
import {currentCatalogEntryAtom, isOnFreePlanAtom} from "@/oss/state/access/atoms"

import AutoRenewalCancelModal from "./Modals/AutoRenewalCancelModal"
import PricingModal from "./Modals/PricingModal"

const Billing = () => {
    const router = useRouter()
    const {projectURL} = useURL()
    const billingEnabled = isBillingEnabled()
    const [isLoadingOpenBillingPortal, setIsLoadingOpenBillingPortal] = useState(false)
    const {subscription, isSubLoading, mutateSubscription} = useSubscriptionData()
    const {usage, isUsageLoading, mutateUsage} = useUsageData()
    const isOnFreePlan = useAtomValue(isOnFreePlanAtom)
    const currentCatalogEntry = useAtomValue(currentCatalogEntryAtom)
    const isCustomPlan = currentCatalogEntry?.type === "custom"
    const [isOpenPricingModal, setIsOpenPricingModal] = useState(false)
    const [isOpenCancelModal, setIsOpenCancelModal] = useState(false)

    // Refresh billing data when component mounts or tab is clicked
    // This ensures fresh data every time the user navigates to the billing tab
    useEffect(() => {
        mutateSubscription()
        mutateUsage()
    }, [mutateSubscription, mutateUsage])

    // Detect return from Stripe and refresh data
    useEffect(() => {
        // Check for Stripe return indicators in query params
        const hasStripeReturn =
            router.query.session_id ||
            router.query.success === "true" ||
            router.query.canceled === "true"

        if (hasStripeReturn) {
            // Refresh billing data after returning from Stripe
            mutateSubscription()
            mutateUsage()

            // Clean up query params
            const {session_id, success, canceled, ...restQuery} = router.query
            router.replace(
                {
                    pathname: router.pathname,
                    query: restQuery,
                },
                undefined,
                {shallow: true},
            )
        }
    }, [router.query, mutateSubscription, mutateUsage])

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

    return (
        <BillingPage
            billingEnabled={billingEnabled}
            loading={isSubLoading || isUsageLoading}
            subscription={subscription}
            usage={usage}
            isOnFreePlan={isOnFreePlan}
            isCustomPlan={isCustomPlan}
            onUpgrade={() => setIsOpenPricingModal(true)}
            onCancelSubscription={onCancelSubscription}
            onOpenBillingPortal={handleOpenBillingPortal}
            openingBillingPortal={isLoadingOpenBillingPortal}
            onViewMembers={navigateToWorkspaceTab}
        >
            <AutoRenewalCancelModal
                open={isOpenCancelModal}
                onCancel={() => setIsOpenCancelModal(false)}
            />
            <PricingModal
                open={isOpenPricingModal}
                onCancel={() => setIsOpenPricingModal(false)}
                onCancelSubscription={onCancelSubscription}
            />
        </BillingPage>
    )
}

export default Billing

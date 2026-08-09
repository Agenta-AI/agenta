import {useState} from "react"

import {
    BillingPage,
    fetchBillingUsage,
    openBillingPortal,
    useBillingCatalog,
    useBillingSubscription,
} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {CancelSubscriptionSheet} from "./CancelSubscriptionSheet"
import {PlanChooserSheet} from "./PlanChooserSheet"

interface Props {
    projectId: string
}

/**
 * Mobile binding: the shared Usage & Billing page, with the plan chooser and the cancellation
 * questionnaire as bottom sheets. Payment itself still goes to Stripe — checkout opens in a new
 * tab, and the portal is where cards and invoices live.
 */
export const BillingTab = ({projectId}: Props) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const billingEnabled = isBillingEnabled()

    const [planChooserOpen, setPlanChooserOpen] = useState(false)
    const [cancelOpen, setCancelOpen] = useState(false)
    const [openingPortal, setOpeningPortal] = useState(false)

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

    // Both the plan and what it has spent move together after any change.
    const refresh = () => {
        void queryClient.invalidateQueries({queryKey: ["billing"]})
    }

    const handleOpenPortal = async () => {
        setOpeningPortal(true)
        try {
            const portalUrl = await openBillingPortal()
            if (portalUrl) window.open(portalUrl, "_blank")
        } finally {
            setOpeningPortal(false)
        }
    }

    return (
        <BillingPage
            billingEnabled={billingEnabled}
            loading={usage.isPending || subscription.isPending}
            subscription={subscription.data}
            usage={usage.data}
            isOnFreePlan={catalog.isOnFreePlan}
            isCustomPlan={catalog.isCustomPlan}
            onUpgrade={billingEnabled ? () => setPlanChooserOpen(true) : undefined}
            onCancelSubscription={billingEnabled ? () => setCancelOpen(true) : undefined}
            onOpenBillingPortal={billingEnabled ? () => void handleOpenPortal() : undefined}
            openingBillingPortal={openingPortal}
            onViewMembers={() =>
                void router.replace({query: {...router.query, tab: "workspace"}}, undefined, {
                    shallow: true,
                })
            }
        >
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
        </BillingPage>
    )
}

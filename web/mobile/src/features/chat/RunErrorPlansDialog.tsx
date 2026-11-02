import {useBillingCatalog, useBillingSubscription} from "@agenta/settings-ui"
import {useQueryClient} from "@tanstack/react-query"

import {PlanChooserSheet} from "../settings/PlanChooserSheet"

import {useBillingRoute} from "./providerRecovery"

/** The Settings plan chooser, opened over the chat so a plan limit is cleared without leaving. */
export const RunErrorPlansDialog = ({
    projectId,
    open,
    onOpenChange,
}: {
    projectId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) => {
    const queryClient = useQueryClient()
    const openBilling = useBillingRoute()
    const subscription = useBillingSubscription({projectId})
    const catalog = useBillingCatalog({projectId, currentPlan: subscription.data?.plan})

    return (
        <PlanChooserSheet
            open={open}
            onOpenChange={onOpenChange}
            projectId={projectId}
            plans={catalog.plans}
            loading={subscription.isPending || catalog.isLoading}
            currentPlan={subscription.data?.plan}
            freePlanSlug={catalog.freePlanSlug}
            isCurrentPlanCustom={catalog.isCustomPlan}
            // A downgrade is a cancellation, which has its own flow on the billing page.
            onCancelSubscription={() => openBilling?.()}
            onChanged={() => {
                void queryClient.invalidateQueries({queryKey: ["billing"]})
                void queryClient.invalidateQueries({queryKey: ["wallet"]})
            }}
        />
    )
}

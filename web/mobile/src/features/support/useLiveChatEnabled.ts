import {useEffect, useState} from "react"

import {
    fetchBillingPricing,
    liveChatAllowed,
    useBillingSubscription,
    type LiveChatPlan,
} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {closeLiveChat, isLiveChatEnabled} from "./crispChat"

/** Client-only: the gate reads `window.__env`, which the server render cannot see. */
export const useLiveChatEnabled = (projectId: string) => {
    const [deploymentEnabled, setDeploymentEnabled] = useState(false)
    useEffect(() => setDeploymentEnabled(isLiveChatEnabled()), [])

    const billingEnabled = deploymentEnabled && isBillingEnabled()
    const subscription = useBillingSubscription({projectId, enabled: billingEnabled})
    // Same query as the billing catalog's; only the free plan's slug matters here.
    const pricing = useQuery({
        queryKey: ["billing", "pricing"],
        queryFn: fetchBillingPricing,
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        enabled: billingEnabled,
    })
    const freePlan = Object.entries(pricing.data ?? {}).find(([, entry]) => entry?.free)?.[0]

    const plan: LiveChatPlan = subscription.isError
        ? "unreadable"
        : !subscription.data || pricing.isPending
          ? "loading"
          : subscription.data.plan === freePlan
            ? "free"
            : "paid"

    const allowed = liveChatAllowed({deploymentEnabled, billingEnabled, plan})
    useEffect(() => {
        if (!allowed) closeLiveChat()
    }, [allowed])
    return allowed
}

import {useCallback} from "react"

import {BUY_CREDITS_CODES, STARTER_CREDIT_CODES} from "@agenta/chat/components"
import {useTopUpOffer} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useRouter} from "next/router"

import {billingUrl, llmProvidersUrl} from "@/lib/context"

const useProjectRoute = () => {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    return typeof workspaceId === "string" && typeof projectId === "string"
        ? {router, workspaceId, projectId}
        : {router, workspaceId: null, projectId: null}
}

/** Settings -> LLM providers, where a key is added or a subscription signed in; undefined off a project. */
export const useProviderRecovery = (): (() => void) | undefined => {
    const {router, workspaceId, projectId} = useProjectRoute()
    const open = useCallback(() => {
        if (workspaceId && projectId) void router.push(llmProvidersUrl({workspaceId, projectId}))
    }, [projectId, router, workspaceId])
    return projectId ? open : undefined
}

/** Settings -> Usage & Billing; undefined off a project or where billing is off. */
export const useBillingRoute = (): (() => void) | undefined => {
    const {router, workspaceId, projectId} = useProjectRoute()
    const open = useCallback(() => {
        if (workspaceId && projectId) void router.push(billingUrl({workspaceId, projectId}))
    }, [projectId, router, workspaceId])
    return isBillingEnabled() && projectId ? open : undefined
}

/** Whether the org can buy a credit pack; asks the API only for a turn out of credits. */
export const useCanBuyCredits = (code: string | null | undefined): boolean => {
    const {projectId} = useProjectRoute()
    const outOfCredits = !!code && (BUY_CREDITS_CODES.has(code) || STARTER_CREDIT_CODES.has(code))
    const wanted = isBillingEnabled() && !!projectId && outOfCredits
    const offer = useTopUpOffer({projectId, enabled: wanted})
    return wanted && offer.data?.status === "available"
}

import {useCallback} from "react"

import {BUY_CREDITS_CODES} from "@agenta/chat/components"
import {useTopUpOffer} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useRouter} from "next/router"

import {billingUrl, buyCreditsUrl, llmProvidersUrl} from "@/lib/context"

/**
 * Where a reader goes when a run failed for a credential they can fix themselves.
 *
 * The shared run-failure callout draws two escapes, "Add your key" for an exhausted starter-credit
 * grant and "Sign in again" for a dead subscription sign-in, and takes each as a prop because the
 * destination is not shared. The desktop sends both to its provider drawer. This app has no drawer,
 * and for a while it passed neither, so those two failure classes left a phone reader with a red
 * bubble and nothing to press.
 *
 * It does have the destination, though: Settings -> LLM providers renders the same AI-providers page
 * the desktop drawer opens, which is where a project key is set and where a subscription sign-in is
 * renewed. One escape for both classes, as on the desktop.
 *
 * Undefined off a project route, where there is no page to send anyone to. The callout's own rule:
 * a button that opens nothing is worse than no button.
 */
export const useProviderRecovery = (): (() => void) | undefined => {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    const inProject = typeof workspaceId === "string" && typeof projectId === "string"

    const open = useCallback(() => {
        if (typeof workspaceId !== "string" || typeof projectId !== "string") return
        void router.push(llmProvidersUrl({workspaceId, projectId}))
    }, [projectId, router, workspaceId])

    return inProject ? open : undefined
}

/**
 * Where a reader goes when a turn met a plan limit: Settings -> Usage & Billing, where the plans
 * live. Undefined off a project route, or where billing is off.
 */
export const useBillingRoute = (): (() => void) | undefined => {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    const available =
        isBillingEnabled() && typeof workspaceId === "string" && typeof projectId === "string"

    const open = useCallback(() => {
        if (typeof workspaceId !== "string" || typeof projectId !== "string") return
        void router.push(billingUrl({workspaceId, projectId}))
    }, [projectId, router, workspaceId])

    return available ? open : undefined
}

/**
 * Where a reader goes to buy a credit pack after running out: Settings -> Credits with the picker
 * open. Only for the out-of-credit class, and only where the organization can buy a pack, so the
 * free plan keeps just the way to the plans. Asks the API only once a turn carries that class.
 */
export const useBuyCreditsRoute = (code: string | null | undefined): (() => void) | undefined => {
    const router = useRouter()
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    const inProject = typeof workspaceId === "string" && typeof projectId === "string"
    const wanted = isBillingEnabled() && inProject && !!code && BUY_CREDITS_CODES.has(code)
    const offer = useTopUpOffer({
        projectId: typeof projectId === "string" ? projectId : null,
        enabled: wanted,
    })

    const open = useCallback(() => {
        if (typeof workspaceId !== "string" || typeof projectId !== "string") return
        void router.push(buyCreditsUrl({workspaceId, projectId}))
    }, [projectId, router, workspaceId])

    return wanted && offer.data?.status === "available" ? open : undefined
}

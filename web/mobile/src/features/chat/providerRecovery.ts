import {useCallback} from "react"

import {useRouter} from "next/router"

import {llmProvidersUrl} from "@/lib/context"

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

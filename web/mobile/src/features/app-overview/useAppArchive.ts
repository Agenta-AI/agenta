import {useCallback, useRef} from "react"

import {
    archiveWorkflow,
    invalidateWorkflowCache,
    invalidateWorkflowsListCache,
} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useRouter} from "next/router"

/**
 * Archive one app, then go to the project home. The guard is a ref: two clicks in one frame read
 * the same render, and only a ref changes between them. A failure throws, so the confirm shows
 * its error and stays open.
 */
export const useAppArchive = ({
    projectId,
    appId,
    base,
}: {
    projectId: string
    appId: string
    base: string
}) => {
    const router = useRouter()
    const inFlight = useRef(false)

    return useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        try {
            await archiveWorkflow(projectId, appId)
        } catch (error) {
            inFlight.current = false
            console.error("Archiving an app failed", error)
            throw new Error("Failed to archive app")
        }
        message.success("App archived")
        // No reset on success: the page leaves, and a second archive of this app has no use.
        // Leave first: once the lists refresh, this app is gone and this page would turn into
        // "not found" for the moment the navigation takes.
        await router.push(`${base}/apps`)
        invalidateWorkflowsListCache()
        invalidateWorkflowCache(appId)
    }, [projectId, appId, base, router])
}

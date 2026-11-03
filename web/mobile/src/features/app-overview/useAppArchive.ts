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
        // Leave before the lists refresh: the app is gone then, and this page would flash
        // "not found" while the navigation runs.
        try {
            await router.push(`${base}/apps`)
        } catch (error) {
            // The app is archived. A failed navigation must not read as a failed archive.
            console.error("Leaving an archived app failed", error)
        } finally {
            invalidateWorkflowsListCache()
            invalidateWorkflowCache(appId)
        }
    }, [projectId, appId, base, router])
}

import {useCallback, useRef, useState} from "react"

import {unarchiveWorkflow} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

/**
 * Restore one archived app, with the toasts and a guard against a second click.
 *
 * TODO: the unarchive call and the cache refresh below are the minimal copy of what the agent
 * card PR adds to `@agenta/entity-ui/agent` as `useRestoreWorkflow`. Switch to that hook once it
 * merges, and keep only the copy and the guard here.
 *
 * The guard is a ref, not state: two clicks in one frame both read the same render's `restoring`,
 * and only a ref changes between them.
 */
export const useRestoreArchivedApp = (projectId: string) => {
    const queryClient = useQueryClient()
    const inFlight = useRef(false)
    const [restoring, setRestoring] = useState(false)

    const restore = useCallback(
        async (id: string) => {
            if (inFlight.current) return
            inFlight.current = true
            setRestoring(true)
            try {
                await unarchiveWorkflow(projectId, id)
            } catch (error) {
                // The server's text is for the logs. The reader gets one plain sentence.
                console.error("Restoring an archived app failed", error)
                message.error("Couldn't restore this app")
                inFlight.current = false
                setRestoring(false)
                return
            }
            message.success("App restored")
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
            // No reset on success: the row leaves with the refetch, and until it does a second
            // click would restore an app that is already restored.
        },
        [projectId, queryClient],
    )

    return {restore, restoring}
}

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

    /**
     * Restore every id in one go, for the bulk bar. Returns the ids that came back, so the
     * caller can drop only those from its selection. One failure does not stop the others.
     */
    const restoreMany = useCallback(
        async (ids: readonly string[]): Promise<string[]> => {
            if (inFlight.current || ids.length === 0) return []
            inFlight.current = true
            setRestoring(true)
            const results = await Promise.allSettled(
                ids.map((id) => unarchiveWorkflow(projectId, id)),
            )
            const restored = ids.filter((_, index) => results[index].status === "fulfilled")
            const failed = ids.length - restored.length
            results.forEach((result) => {
                if (result.status === "rejected")
                    console.error("Restoring an archived app failed", result.reason)
            })
            if (restored.length > 0) {
                message.success(
                    restored.length === 1 ? "App restored" : `${restored.length} apps restored`,
                )
                void queryClient.invalidateQueries({queryKey: ["workflows"]})
                void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
            }
            if (failed > 0) {
                message.error(
                    failed === 1 ? "Couldn't restore 1 app" : `Couldn't restore ${failed} apps`,
                )
            }
            // The screen keeps this hook for the whole visit, so the guard is freed here. The
            // caller clears the restored ids from its selection, so a second click has nothing to send.
            inFlight.current = false
            setRestoring(false)
            return restored
        },
        [projectId, queryClient],
    )

    return {restore, restoreMany, restoring}
}

import {useCallback, useRef, useState} from "react"

import {testsetMolecule} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

/**
 * Restore one archived test set, with the toasts and a guard against a second click.
 *
 * The guard is a ref, not state: two clicks in one frame both read the same render's `restoring`,
 * and only a ref changes between them. After a success the guard stays on: the row leaves with
 * the refetch, and until it does a second click would restore a test set that is already restored.
 */
export const useRestoreTestset = (projectId: string) => {
    const queryClient = useQueryClient()
    const inFlight = useRef(false)
    const [restoring, setRestoring] = useState(false)

    const restore = useCallback(
        async (testsetId: string) => {
            if (inFlight.current) return
            inFlight.current = true
            setRestoring(true)
            try {
                await testsetMolecule.lifecycle.unarchive(testsetId, {projectId})
            } catch (error) {
                // The server's text is for the logs. The reader gets one plain sentence.
                console.error("Restoring an archived test set failed", error)
                message.error("Couldn't restore this test set")
                inFlight.current = false
                setRestoring(false)
                return
            }
            message.success("Test set restored")
            void queryClient.invalidateQueries({queryKey: ["testsets"]})
        },
        [projectId, queryClient],
    )

    return {restore, restoring}
}

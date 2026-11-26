import {useCallback, useRef, useState} from "react"

import {invalidateEvaluatorsListCache} from "@agenta/entities/workflow"
import {useRestoreWorkflow} from "@agenta/entity-ui/agent"
import {message} from "@agenta/ui/app-message"

/**
 * Restore one archived evaluator, with the toasts and a guard against a second click.
 *
 * The guard is a ref, not state: two clicks in one frame both read the same render's `restoring`,
 * and only a ref changes between them. After a restore the guard stays on until the row has left
 * the archived list, because `useRestoreWorkflow` waits for the lists to refetch.
 */
export const useRestoreEvaluator = () => {
    const restoreWorkflow = useRestoreWorkflow()
    const inFlight = useRef(false)
    const [restoring, setRestoring] = useState(false)

    const restore = useCallback(
        async (workflowId: string) => {
            if (inFlight.current) return
            inFlight.current = true
            setRestoring(true)
            try {
                if (await restoreWorkflow(workflowId)) {
                    message.success("Evaluator restored")
                    // The pickers elsewhere in the app read their own copy of the list.
                    invalidateEvaluatorsListCache()
                } else {
                    // The server's text is for the logs. The reader gets one plain sentence.
                    message.error("Couldn't restore this evaluator")
                }
            } finally {
                inFlight.current = false
                setRestoring(false)
            }
        },
        [restoreWorkflow],
    )

    return {restore, restoring}
}

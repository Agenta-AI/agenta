import {useCallback, useRef, useState} from "react"

import {editEvaluationRunMeta, evaluationRunQueryKey} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

/**
 * Save a run's name and description, with the toasts and a guard against a second click.
 *
 * `save` answers whether the run was saved, so the form closes on success and stays open, with
 * the typed values, on a failure. The guard is a ref, not state: two clicks in one frame both read
 * the same render's `saving`, and only a ref changes between them.
 */
export const useRenameRun = (projectId: string, runId: string) => {
    const queryClient = useQueryClient()
    const inFlight = useRef(false)
    const [saving, setSaving] = useState(false)

    const save = useCallback(
        async (name: string, description: string): Promise<boolean> => {
            if (inFlight.current) return false
            inFlight.current = true
            setSaving(true)
            try {
                await editEvaluationRunMeta({
                    projectId,
                    runId,
                    name: name.trim(),
                    description: description.trim(),
                })
            } catch (error) {
                // The server's text is for the logs. The reader gets one plain sentence.
                console.error("Renaming an evaluation run failed", error)
                message.error("Failed to update evaluation run")
                return false
            } finally {
                inFlight.current = false
                setSaving(false)
            }
            message.success("Evaluation run updated")
            // The page title reads the run query. The runs list reads its own cache.
            await Promise.all([
                queryClient.invalidateQueries({queryKey: evaluationRunQueryKey(runId)}),
                queryClient.invalidateQueries({queryKey: ["evaluation-runs"]}),
            ])
            return true
        },
        [projectId, runId, queryClient],
    )

    return {save, saving}
}

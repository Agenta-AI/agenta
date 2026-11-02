import {useCallback, useRef, useState} from "react"

import {findEvaluationRunsUsing} from "@agenta/entities/evaluationRun"
import {
    archiveWorkflow,
    invalidateEvaluatorsListCache,
    isHumanEvaluator,
    type EvaluatorEntry,
} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

export type ArchiveOutcome =
    | {status: "archived"}
    /** Evaluation runs still use an evaluator. Nothing was archived. */
    | {status: "in-use"; runCount: number}
    | {status: "failed"}

/**
 * Archive evaluators, with the toasts. An automatic evaluator that an evaluation run uses is not
 * archived. Whether an evaluator is automatic comes from the evaluator itself, never from the tab
 * the reader is on. A second call while one runs does nothing and reports `failed` without a toast.
 */
export const useArchiveEvaluators = (projectId: string) => {
    const queryClient = useQueryClient()
    const inFlight = useRef(false)
    const [archiving, setArchiving] = useState(false)

    const archive = useCallback(
        async (
            entries: readonly EvaluatorEntry[],
            {checkInUse}: {checkInUse: boolean},
        ): Promise<ArchiveOutcome> => {
            if (inFlight.current || entries.length === 0) return {status: "failed"}
            inFlight.current = true
            setArchiving(true)
            try {
                const automaticIds = entries
                    .filter((entry) => !isHumanEvaluator(entry.latestRevision))
                    .map((entry) => entry.workflow.id)
                if (checkInUse && automaticIds.length > 0) {
                    const runIds = await findEvaluationRunsUsing({
                        projectId,
                        references: automaticIds.map((id) => ({evaluator: {id}})),
                    })
                    if (runIds.length > 0) return {status: "in-use", runCount: runIds.length}
                }
                // Wait for every request, so the refresh below sees all of them.
                const results = await Promise.allSettled(
                    entries.map((entry) => archiveWorkflow(projectId, entry.workflow.id)),
                )
                invalidateEvaluatorsListCache()
                await queryClient.invalidateQueries({queryKey: ["workflows"]})
                const failed = results.find((result) => result.status === "rejected")
                if (failed) throw failed.reason
            } catch (error) {
                // The server's text is for the logs. The reader gets one plain sentence.
                console.error("Archiving evaluators failed", error)
                message.error("Failed to archive evaluators")
                return {status: "failed"}
            } finally {
                inFlight.current = false
                setArchiving(false)
            }
            message.success(
                entries.length === 1
                    ? "Evaluator archived"
                    : `${entries.length} evaluators archived`,
            )
            return {status: "archived"}
        },
        [projectId, queryClient],
    )

    return {archive, archiving}
}

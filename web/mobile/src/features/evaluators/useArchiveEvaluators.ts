import {useCallback, useRef, useState} from "react"

import {findEvaluationRunsUsing} from "@agenta/entities/evaluationRun"
import {archiveWorkflow, invalidateEvaluatorsListCache} from "@agenta/entities/workflow"
import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

export type ArchiveOutcome =
    | {status: "archived"}
    /** Evaluation runs still use the evaluator. Nothing was archived. */
    | {status: "in-use"; runCount: number}
    | {status: "failed"}

/**
 * Archive evaluators, with the toasts. An automatic evaluator that an evaluation run uses is not
 * archived. A second call while one runs does nothing and reports `failed` without a toast.
 */
export const useArchiveEvaluators = (projectId: string) => {
    const queryClient = useQueryClient()
    const inFlight = useRef(false)
    const [archiving, setArchiving] = useState(false)

    const archive = useCallback(
        async (
            workflowIds: readonly string[],
            category: EvaluatorCategory,
        ): Promise<ArchiveOutcome> => {
            if (inFlight.current || workflowIds.length === 0) return {status: "failed"}
            inFlight.current = true
            setArchiving(true)
            try {
                if (category === "automatic") {
                    const runIds = await findEvaluationRunsUsing({
                        projectId,
                        references: workflowIds.map((id) => ({evaluator: {id}})),
                    })
                    if (runIds.length > 0) return {status: "in-use", runCount: runIds.length}
                }
                await Promise.all(workflowIds.map((id) => archiveWorkflow(projectId, id)))
            } catch (error) {
                // The server's text is for the logs. The reader gets one plain sentence.
                console.error("Archiving evaluators failed", error)
                message.error("Failed to archive evaluators")
                // Some may have been archived before one failed: show the list as it is now.
                void queryClient.invalidateQueries({queryKey: ["workflows"]})
                return {status: "failed"}
            } finally {
                inFlight.current = false
                setArchiving(false)
            }
            message.success(
                workflowIds.length === 1
                    ? "Evaluator archived"
                    : `${workflowIds.length} evaluators archived`,
            )
            invalidateEvaluatorsListCache()
            await queryClient.invalidateQueries({queryKey: ["workflows"]})
            return {status: "archived"}
        },
        [projectId, queryClient],
    )

    return {archive, archiving}
}

import {useCallback, useRef, useState} from "react"

import {
    deleteEvaluationRuns,
    evaluationRunQueryKey,
    startOnlineEvaluation,
    stopOnlineEvaluation,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {copyToClipboard} from "@agenta/ui/utils"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {useProjectPermission} from "../../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"
import {useRevisionParam} from "../../revisions/useRevisionParam"
import {useConfirmModal} from "../../settings/useConfirmModal"

import {readRunReferences, runDisplayName} from "./runReferences"
import {RUNS_LIST_KEY} from "./runsListKey"

/**
 * The actions of a run row and of the selected runs. Stop, resume and delete need
 * `edit_evaluation_runs`: a reader without it gets no such verb. Delete is allowed at any run
 * status.
 */
export const useRunRowActions = ({projectId, base}: {projectId: string; base: string}) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const canEdit = useProjectPermission(projectId, "edit_evaluation_runs")
    const testsetsViewOn = useDeveloperViewEnabled("testsets") === true
    const [, setRevisionId] = useRevisionParam()
    const {confirm, modal} = useConfirmModal()
    // The ref blocks a second click in the same tick, the state redraws the menu.
    const busyRef = useRef(new Set<string>())
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

    // Work on several runs (a bulk delete) holds all of them: none can start another action.
    const runExclusive = useCallback(
        async (runIds: string | readonly string[], work: () => Promise<void>) => {
            const ids = typeof runIds === "string" ? [runIds] : runIds
            if (ids.some((id) => busyRef.current.has(id))) return
            ids.forEach((id) => busyRef.current.add(id))
            setBusy(new Set(busyRef.current))
            try {
                await work()
            } finally {
                ids.forEach((id) => busyRef.current.delete(id))
                setBusy(new Set(busyRef.current))
            }
        },
        [],
    )

    const refreshList = useCallback(
        () => queryClient.invalidateQueries({queryKey: RUNS_LIST_KEY}),
        [queryClient],
    )

    const open = useCallback(
        (run: EvaluationRun) => void router.push(`${base}/evaluations/results/${run.id}`),
        [router, base],
    )

    const copyId = useCallback(async (run: EvaluationRun) => {
        if (await copyToClipboard(run.id)) message.success("Copied to clipboard!")
        else message.error("Couldn't copy the run ID")
    }, [])

    const toggleLive = useCallback(
        (run: EvaluationRun, active: boolean) =>
            runExclusive(run.id, async () => {
                const verb = active ? "stop" : "resume"
                try {
                    if (active) await stopOnlineEvaluation({projectId, runId: run.id})
                    else await startOnlineEvaluation({projectId, runId: run.id})
                    message.success(active ? "Evaluation stopped" : "Evaluation resumed")
                } catch (error) {
                    console.error(`Could not ${verb} the evaluation`, error)
                    message.error(`Failed to ${verb} evaluation`)
                }
                await refreshList()
            }),
        [projectId, refreshList, runExclusive],
    )

    const viewVariant = useCallback(
        (run: EvaluationRun) => {
            const {applicationRevisionId} = readRunReferences(run)
            if (applicationRevisionId) setRevisionId(applicationRevisionId)
        },
        [setRevisionId],
    )

    const viewTestset = useCallback(
        (run: EvaluationRun) => {
            const {testsetId, testsetRevisionId} = readRunReferences(run)
            const target = testsetRevisionId ?? testsetId
            if (target) void router.push(`${base}/testsets/${target}`)
        },
        [router, base],
    )

    /**
     * Deletes the runs after one confirm that names them. `onDeleted` runs once they are gone (the
     * list clears its selection). A failed delete keeps the confirm open with its retry.
     */
    const removeRuns = useCallback(
        (runs: readonly EvaluationRun[], onDeleted?: () => void) => {
            if (runs.length === 0) return
            const runIds = runs.map((run) => run.id)
            const many = runs.length > 1
            confirm({
                title: "Are you sure you want to delete?",
                message: (
                    <>
                        <span className="block">
                            {many
                                ? `The selected ${runs.length} evaluations will be permanently deleted.`
                                : "A deleted evaluation cannot be restored."}
                        </span>
                        <span className="mt-3 block">
                            {many
                                ? "You are about to delete the following evaluations:"
                                : "You are about to delete:"}
                        </span>
                        <span className={many ? "block max-h-40 overflow-y-auto" : "block"}>
                            {runs.map((run) => (
                                <span key={run.id} className="block font-medium text-foreground">
                                    {many ? `• ${runDisplayName(run)}` : runDisplayName(run)}
                                </span>
                            ))}
                        </span>
                    </>
                ),
                okText: "Delete",
                danger: true,
                onOk: () =>
                    runExclusive(runIds, async () => {
                        try {
                            await deleteEvaluationRuns({projectId, runIds})
                        } catch (error) {
                            console.error("Could not delete the evaluations", error)
                            // Thrown, so the confirm stays open with the message and its Delete retry.
                            throw new Error("Failed to delete evaluations")
                        }
                        runIds.forEach((runId) =>
                            queryClient.removeQueries({queryKey: evaluationRunQueryKey(runId)}),
                        )
                        message.success("Deleted successfully")
                        onDeleted?.()
                        await refreshList()
                    }),
            })
        },
        [confirm, projectId, queryClient, refreshList, runExclusive],
    )

    const remove = useCallback((run: EvaluationRun) => removeRuns([run]), [removeRuns])

    return {
        canEdit,
        testsetsViewOn,
        open,
        copyId,
        toggleLive,
        viewVariant,
        viewTestset,
        remove,
        removeRuns,
        isBusy: (runId: string) => busy.has(runId),
        /** Render once, near the list: the delete confirm. */
        modal,
    }
}

export type RunRowActions = ReturnType<typeof useRunRowActions>

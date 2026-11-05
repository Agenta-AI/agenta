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
 * The actions of a run row. Stop, resume and delete need `edit_evaluation_runs`: a reader
 * without it gets no such verb in the menu. Delete is allowed at any run status.
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

    const runExclusive = useCallback(async (runId: string, work: () => Promise<void>) => {
        if (busyRef.current.has(runId)) return
        busyRef.current.add(runId)
        setBusy(new Set(busyRef.current))
        try {
            await work()
        } finally {
            busyRef.current.delete(runId)
            setBusy(new Set(busyRef.current))
        }
    }, [])

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

    const remove = useCallback(
        (run: EvaluationRun) =>
            confirm({
                title: "Are you sure you want to delete?",
                message: (
                    <>
                        <span className="block">A deleted evaluation cannot be restored.</span>
                        <span className="mt-3 block">You are about to delete:</span>
                        <span className="block font-medium text-foreground">
                            {runDisplayName(run)}
                        </span>
                    </>
                ),
                okText: "Delete",
                danger: true,
                onOk: () =>
                    runExclusive(run.id, async () => {
                        try {
                            await deleteEvaluationRuns({projectId, runIds: [run.id]})
                        } catch (error) {
                            console.error("Could not delete the evaluation", error)
                            // Thrown, so the confirm stays open with the message and its Delete retry.
                            throw new Error("Failed to delete evaluations")
                        }
                        queryClient.removeQueries({queryKey: evaluationRunQueryKey(run.id)})
                        message.success("Deleted successfully")
                        await refreshList()
                    }),
            }),
        [confirm, projectId, queryClient, refreshList, runExclusive],
    )

    return {
        canEdit,
        testsetsViewOn,
        open,
        copyId,
        toggleLive,
        viewVariant,
        viewTestset,
        remove,
        isBusy: (runId: string) => busy.has(runId),
        /** Render once, near the list: the delete confirm. */
        modal,
    }
}

export type RunRowActions = ReturnType<typeof useRunRowActions>

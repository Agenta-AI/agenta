import deepEqual from "fast-deep-equal"
import {Atom, atom} from "jotai"
import {atomFamily, loadable, selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithImmer} from "jotai-immer"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"

import {EvaluationLoadingState} from "../../types"
import {defaultLoadingState} from "../constants"

// import {bulkStepsCacheAtom} from "./bulkFetch"

import {evaluationRunStateFamily} from "./runScopedAtoms"
import {
    displayedScenarioIdsFamily,
    scenarioIdsFamily,
    scenarioStepFamily,
    scenarioStepLocalFamily,
} from "./runScopedScenarios"
import {ScenarioCounts, StatusCounters} from "./types"

// ---------------- Shared counter helper ----------------
const emptyCounters = (): StatusCounters => ({
    pending: 0,
    running: 0,
    completed: 0,
    cancelled: 0,
    unannotated: 0,
    failed: 0,
})

const tallyStatus = (counters: StatusCounters, status: string): void => {
    switch (status) {
        case "pending":
        case "revalidating":
            counters.pending += 1
            break
        case "running":
            counters.running += 1
            break
        case "success":
        case "done":
            counters.completed += 1
            break
        case "incomplete":
            counters.unannotated += 1
            break
        case "failed":
        case "failure":
        case "error":
            counters.failed += 1
            break
        case "cancelled":
            counters.cancelled += 1
            break
        default:
            counters.pending += 1
    }
}

export const progressFamily = atomFamily(
    (runId: string) =>
        eagerAtom((get) => {
            const scenarios = get(evaluationRunStateFamily(runId)).scenarios || []
            const counters = emptyCounters()

            scenarios.forEach((s) => {
                const statusLoadable = get(
                    loadable(scenarioStatusFamily({scenarioId: s.id, runId})),
                )
                const status =
                    statusLoadable.state === "hasData" ? statusLoadable.data.status : "pending"
                tallyStatus(counters, status)
            })

            const percentComplete =
                counters.completed + counters.failed + counters.cancelled + counters.unannotated > 0
                    ? Math.round((counters.completed / scenarios.length) * 100)
                    : 0

            return {
                total: scenarios.length,
                pending: counters.pending,
                inProgress: counters.running,
                completed: counters.completed,
                error: counters.failed,
                cancelled: counters.cancelled,
                percentComplete,
            }
        }),
    deepEqual,
)

export const loadingStateAtom = atomWithImmer<EvaluationLoadingState>(defaultLoadingState)

// Run-scoped atom family to compute scenario step progress for displayedScenarioIds
export const scenarioStepProgressFamily = atomFamily(
    (runId: string) =>
        atom((get) => {
            const loadingStates = get(loadingStateAtom)
            // If we're still fetching the evaluation or scenarios list, reflect that first
            if (
                loadingStates.activeStep &&
                ["eval-run", "scenarios"].includes(loadingStates.activeStep)
            ) {
                return {
                    completed: 0,
                    total: 0,
                    percent: 0,
                    loadingStep: loadingStates.activeStep,
                }
            }
            const loadableIds = get(loadable(displayedScenarioIdsFamily(runId)))

            if (loadableIds.state !== "hasData") {
                return {completed: 0, total: 0, percent: 0, loadingStep: null}
            }
            const scenarioIds: string[] = Array.isArray(loadableIds.data) ? loadableIds.data : []
            const total = scenarioIds.length

            let completed = 0
            scenarioIds.forEach((scenarioId: string) => {
                if (get(scenarioStepLocalFamily({runId, scenarioId}))) completed++
            })
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0
            return {
                completed,
                total,
                percent,
                allStepsFetched: completed === total && total > 0,
                loadingStep: completed < total ? "scenario-steps" : null,
            }
        }),
    deepEqual,
)

export const scenarioStatusFamily = atomFamily((params: {scenarioId: string; runId: string}) => {
    return atom(async (get) => {
        const data = await get(scenarioStepFamily(params))
        const evalType = get(evalTypeAtom)

        const normalizeStatus = (status: unknown) => {
            if (typeof status === "string") return status.toLowerCase()
            if (status === null || status === undefined) return ""
            return String(status).toLowerCase()
        }

        const hasStatus = (steps: any[] | undefined, matcher: (status: string) => boolean) => {
            if (!Array.isArray(steps)) return false
            return steps.some((step) => matcher(normalizeStatus(step?.status)))
        }

        const everyStatus = (steps: any[] | undefined, matcher: (status: string) => boolean) => {
            if (!Array.isArray(steps) || steps.length === 0) return false
            return steps.every((step) => matcher(normalizeStatus(step?.status)))
        }

        const isSuccessStatus = (status: string) =>
            status === "success" ||
            status === "succeeded" ||
            status === "successful" ||
            status === "completed" ||
            status === "complete" ||
            status === "done" ||
            status === "finished"

        const isFailureStatus = (status: string) =>
            status === "failure" || status === "failed" || status === "error"

        const isRunningStatus = (status: string) =>
            status === "running" ||
            status === "in_progress" ||
            status === "in progress" ||
            status === "processing" ||
            status === "queued" ||
            status === "started" ||
            status === "starting"

        const isAnnotatingStatus = (status: string) => status === "annotating"
        const isRevalidatingStatus = (status: string) => status === "revalidating"

        const invocationSteps: any[] = Array.isArray(data?.invocationSteps)
            ? data.invocationSteps
            : []
        const annotationSteps: any[] = Array.isArray(data?.annotationSteps)
            ? data.annotationSteps
            : []

        const isRunning =
            hasStatus(data?.invocationSteps, isRunningStatus) ||
            hasStatus(data?.annotationSteps, isRunningStatus) ||
            hasStatus(data?.inputSteps, isRunningStatus)

        const isAnnotating = hasStatus(data?.annotationSteps, isAnnotatingStatus)
        const isRevalidating = hasStatus(data?.annotationSteps, isRevalidatingStatus)

        // Determine scenario status based on step outcomes
        let computedStatus = "pending"
        const allInvSucceeded = everyStatus(invocationSteps, isSuccessStatus)
        const allAnnSucceeded = everyStatus(annotationSteps, isSuccessStatus)
        const anyFailed =
            hasStatus(data?.invocationSteps, isFailureStatus) ||
            hasStatus(data?.annotationSteps, isFailureStatus) ||
            hasStatus(data?.inputSteps, isFailureStatus)

        if (isRunning) {
            computedStatus = "running"
        } else if (isAnnotating) {
            computedStatus = "annotating"
        } else if (isRevalidating) {
            computedStatus = "revalidating"
        } else if (allAnnSucceeded) {
            computedStatus = "success"
        } else if (allInvSucceeded) {
            // Auto and online evals treat successful invocations as completion
            const isAutoLikeEval =
                evalType === "auto" || evalType === "online" || evalType === "custom"
            computedStatus = isAutoLikeEval ? "success" : "incomplete"
        } else if (anyFailed) {
            computedStatus = "failure"
        } else {
            computedStatus = "pending"
        }

        return {
            status: computedStatus,
            isAnnotating,
            isRevalidating,
        }
    })
}, deepEqual)

export const scenarioStatusAtomFamily = atomFamily((params: {scenarioId: string; runId: string}) =>
    atom((get) => {
        const loadableStatus = get(loadable(scenarioStatusFamily(params)))
        return loadableStatus.state === "hasData" ? loadableStatus.data : {status: "pending"}
    }),
)

// Aggregate all scenario steps into a single object keyed by scenarioId (loadable)
// Convenience wrapper so components can safely read status without suspending
export const loadableScenarioStatusFamily = atomFamily(
    (params: {scenarioId: string; runId: string}) => loadable(scenarioStatusFamily(params)),
    deepEqual,
)

// Lightweight UI flags derived from scenario status
export const scenarioUiFlagsFamily = atomFamily((params: {scenarioId: string; runId: string}) => {
    return atom((get) => {
        const statusLoadable = get(loadable(scenarioStatusFamily(params)))
        if (statusLoadable.state !== "hasData") {
            return {isAnnotating: false, isRevalidating: false}
        }
        const {isAnnotating, isRevalidating, status} = statusLoadable.data as any
        return {
            isAnnotating: isAnnotating ?? status === "annotating",
            isRevalidating: isRevalidating ?? status === "revalidating",
        }
    })
}, deepEqual)

export const scenarioCountsFamily = atomFamily((runId: string) => {
    return atom<ScenarioCounts>((get) => {
        const ids = get(scenarioIdsFamily(runId))
        const c = emptyCounters()
        for (const id of ids) {
            const st = get(scenarioStatusAtomFamily({scenarioId: id, runId})) as any
            tallyStatus(c, st?.status ?? "pending")
        }
        return {
            total: ids.length,
            pending: c.pending,
            unannotated: c.unannotated,
            failed: c.failed,
        }
    })
}, deepEqual)

// Run-scoped count atoms
export const pendingCountFamily = atomFamily((runId: string) => {
    return selectAtom<ScenarioCounts, number>(
        scenarioCountsFamily(runId),
        (c) => c.pending,
        deepEqual,
    )
}, deepEqual)

export const unannotatedCountFamily = atomFamily((runId: string) => {
    return selectAtom<ScenarioCounts, number>(
        scenarioCountsFamily(runId),
        (c) => c.unannotated,
        deepEqual,
    )
}, deepEqual)

export const failedCountFamily = atomFamily((runId: string) => {
    return selectAtom<ScenarioCounts, number>(
        scenarioCountsFamily(runId),
        (c) => c.failed,
        deepEqual,
    )
}, deepEqual)

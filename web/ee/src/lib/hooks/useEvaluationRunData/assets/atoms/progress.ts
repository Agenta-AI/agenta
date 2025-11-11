import deepEqual from "fast-deep-equal"
import {Atom, atom} from "jotai"
import {atomFamily, loadable, selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithImmer} from "jotai-immer"

import {EvaluationLoadingState, ScenarioStatusMap} from "../../types"
import {defaultLoadingState} from "../constants"

// import {bulkStepsCacheAtom} from "./bulkFetch"
import {evaluationRunStateAtom} from "./evaluationRunStateAtom"
import {scenarioIdsAtom, scenarioStepLocalFamily} from "./scenarios"
import {displayedScenarioIds, scenarioStepFamily} from "./scenarios"
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

export const progressAtom = eagerAtom((get) => {
    const scenarios = get(evaluationRunStateAtom).scenarios || []
    const counters = emptyCounters()

    scenarios.forEach((s) => {
        const statusLoadable = get(loadable(scenarioStatusFamily(s.id)))
        const status = statusLoadable.state === "hasData" ? statusLoadable.data.status : "pending"
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
})

export const loadingStateAtom = atomWithImmer<EvaluationLoadingState>(defaultLoadingState)

// Derived atom to compute scenario step progress for displayedScenarioIds
export const scenarioStepProgressAtom = atom((get) => {
    const loadingStates = get(loadingStateAtom)
    // If we're still fetching the evaluation or scenarios list, reflect that first
    if (loadingStates.activeStep && ["eval-run", "scenarios"].includes(loadingStates.activeStep)) {
        return {completed: 0, total: 0, percent: 0, loadingStep: loadingStates.activeStep}
    }
    const loadableIds = get(loadable(displayedScenarioIds))

    if (loadableIds.state !== "hasData") {
        return {completed: 0, total: 0, percent: 0, loadingStep: null}
    }
    const scenarioIds: string[] = Array.isArray(loadableIds.data) ? loadableIds.data : []
    const total = scenarioIds.length

    // const bulkMap = get(bulkStepsCacheAtom)
    let completed = 0
    scenarioIds.forEach((scenarioId: string) => {
        if (get(scenarioStepLocalFamily(scenarioId))) completed++
    })
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return {
        completed,
        total,
        percent,
        allStepsFetched: completed === total && total > 0,
        loadingStep: completed < total ? "scenario-steps" : null,
    }
})

export const scenarioStatusFamily = atomFamily((scenarioId: string) => {
    return atom(async (get) => {
        const data = await get(scenarioStepFamily(scenarioId))

        const invocationSteps: any[] = Array.isArray(data?.invocationSteps)
            ? data.invocationSteps
            : []
        const annotationSteps: any[] = Array.isArray(data?.annotationSteps)
            ? data.annotationSteps
            : []

        const isRunning =
            data?.invocationSteps.some((s) => s.status === "running") ||
            data?.annotationSteps.some((s) => s.status === "running") ||
            data?.inputSteps.some((s) => s.status === "running")

        const isAnnotating = data?.annotationSteps.some((s) => s.status === "annotating")
        const isRevalidating = data?.annotationSteps.some((s) => s.status === "revalidating")

        // Determine scenario status based on step outcomes
        let computedStatus = "pending"
        const allInvSucceeded =
            invocationSteps.length > 0 && invocationSteps.every((s) => s.status === "success")
        const allAnnSucceeded =
            annotationSteps.length > 0 && annotationSteps.every((s) => s.status === "success")
        const anyFailed =
            data?.invocationSteps.some((s) => s.status === "failure") ||
            data?.annotationSteps.some((s) => s.status === "failure") ||
            data?.inputSteps.some((s) => s.status === "failure")

        if (isRunning) {
            computedStatus = "running"
        } else if (isAnnotating) {
            computedStatus = "annotating"
        } else if (isRevalidating) {
            computedStatus = "revalidating"
        } else if (allAnnSucceeded) {
            computedStatus = "success"
        } else if (allInvSucceeded) {
            computedStatus = "incomplete"
        } else if (anyFailed) {
            computedStatus = "failure"
        } else {
            computedStatus = "pending"
        }

        // Preserve legacy result extraction (first invocation step value)
        // let result: any = undefined
        // if (invocationSteps.length) {
        //     try {
        //         const {value} = readInvocationResponse({
        //             scenarioData: data,
        //             stepKey: invocationSteps[0].key,
        //         })
        //         result = value
        //     } catch {}
        // }

        return {
            status: computedStatus,
            isAnnotating,
            isRevalidating,
        }
    })
}, deepEqual)

export const scenarioStatusAtomFamily = atomFamily((id: string) =>
    atom((get) => {
        const loadableStatus = get(loadable(scenarioStatusFamily(id)))
        return loadableStatus.state === "hasData" ? loadableStatus.data : {status: "pending"}
    }),
)

// Aggregate all scenario steps into a single object keyed by scenarioId (loadable)
// Convenience wrapper so components can safely read status without suspending
export const loadableScenarioStatusFamily = atomFamily(
    (scenarioId: string) => loadable(scenarioStatusFamily(scenarioId)),
    deepEqual,
)

// Lightweight UI flags derived from scenario status
export const scenarioUiFlagsFamily = atomFamily((scenarioId: string) => {
    return atom((get) => {
        const statusLoadable = get(loadable(scenarioStatusFamily(scenarioId)))
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

// Compute status map from scenario steps (handle loading/error states)
// Build a lightweight status map derived only from per-scenario status atoms.
// Avoid touching bulky `scenarioStepsAtom`, which contains full trace data and
// causes large JSON clones. This dramatically reduces work when components read
// counts or individual statuses.
// Internal cache to preserve reference when no status actually changes
// let _cachedStatusMap: ScenarioStatusMap | undefined
// export const statusMapAtom = atom((get) => {
//     const ids = get(scenarioIdsAtom)
//     const map: ScenarioStatusMap = {}

//     let changed = false
//     for (const scenarioId of ids) {
//         const status = {status: "pending"}
//         // get(scenarioStatusAtomFamily(scenarioId)) as any
//         const latest = status ?? {status: "pending"}
//         if (!changed && _cachedStatusMap && deepEqual(_cachedStatusMap[scenarioId], latest)) {
//             // no change for this id
//         } else {
//             changed = true
//         }
//         map[scenarioId] = latest
//     }
//     if (!changed && _cachedStatusMap) return _cachedStatusMap
//     _cachedStatusMap = map
//     return map
// })

export const scenarioCountsAtom = atom<ScenarioCounts>((get) => {
    const ids = get(scenarioIdsAtom)
    const c = emptyCounters()
    for (const id of ids) {
        const st = get(scenarioStatusAtomFamily(id)) as any
        tallyStatus(c, st?.status ?? "pending")
    }
    return {
        total: ids.length,
        pending: c.pending,
        unannotated: c.unannotated,
        failed: c.failed,
    }
})

const scenarioCountsAtomTyped = scenarioCountsAtom as unknown as Atom<ScenarioCounts>

// Lightweight total scenario count (no status reads)
export const pendingCountAtom = selectAtom<ScenarioCounts, number>(
    scenarioCountsAtomTyped,
    (c) => c.pending,
    deepEqual,
)
export const unannotatedCountAtom = selectAtom<ScenarioCounts, number>(
    scenarioCountsAtomTyped,
    (c) => c.unannotated,
    deepEqual,
)
export const failedCountAtom = selectAtom<ScenarioCounts, number>(
    scenarioCountsAtomTyped,
    (c) => c.failed,
    deepEqual,
)

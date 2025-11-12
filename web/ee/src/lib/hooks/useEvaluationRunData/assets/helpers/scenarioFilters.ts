import {Getter} from "jotai"
import {loadable} from "jotai/utils"

import {IScenario} from "@/oss/lib/hooks/useEvaluationRunScenarios/types"

import {scenarioStatusFamily} from "../atoms/progress"
import {scenarioStepFamily} from "../atoms/runScopedScenarios"

export type ScenarioFilter = "all" | "pending" | "failed" | "unannotated"

/**
 * Determine whether a scenario matches the active filter.
 *
 * All atoms that need scenario filtering (counts, displayed list, etc.) should
 * use this utility to guarantee that numbers and UI stay in sync.
 */
export const scenarioMatchesFilter = (
    get: Getter,
    scenario: IScenario,
    filter: ScenarioFilter,
    runId: string,
): boolean => {
    if (filter === "all") return true

    const scenarioId = (scenario as any).id || (scenario as any)._id

    if (filter === "pending") {
        const statusLoad = get(loadable(scenarioStatusFamily({runId, scenarioId})))
        if (statusLoad.state !== "hasData") return true // treat unknown as pending while loading
        const st = statusLoad.data.status
        return ["pending", "running", "initialized", "started"].includes(st)
    }

    if (filter === "failed") {
        const statusLoad = get(loadable(scenarioStatusFamily({runId, scenarioId})))
        if (statusLoad.state !== "hasData") return false
        const st = statusLoad.data.status
        return st === "failure" || st === "error"
    }

    if (filter === "unannotated") {
        const stepLoad = get(loadable(scenarioStepFamily({runId, scenarioId})))
        if (stepLoad.state !== "hasData") return true // include while loading
        const data = stepLoad.data
        const hasAnn =
            Array.isArray(data?.annotationSteps) &&
            data.annotationSteps.length > 0 &&
            data.annotationSteps.every((s: any) => !!s?.annotation)
        const allInvSucceeded =
            Array.isArray(data?.invocationSteps) &&
            data.invocationSteps.every((s) => s.status === "success")
        return allInvSucceeded && !hasAnn
    }

    return true
}

export const filterScenarios = (
    get: Getter,
    scenarios: IScenario[],
    filter: ScenarioFilter,
    runId: string,
): IScenario[] => {
    if (!filter || filter === "all") return scenarios
    return scenarios.filter((s) => scenarioMatchesFilter(get, s, filter, runId))
}

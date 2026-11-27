/**
 * Every per-test-case metric row of one run, read once the run has finished. It feeds the
 * "Passed" tile and the failed test cases of the overview. It does not poll: a running run would send a large request every
 * few seconds. Online runs never read it (one row per trace, no upper bound).
 *
 * @packageDocumentation
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryRunScenarioMetrics} from "../api/runDetails"
import {
    deriveEvaluationKind,
    isTerminalRunStatus,
    SCENARIO_METRICS_LIMIT,
    type EvaluationMetric,
} from "../core"

import {evaluationRunQueryAtomFamily} from "./molecule"

export const runScenarioMetricsQueryKey = (projectId: string, runId: string) =>
    ["evaluation-run-scenario-metrics", projectId, runId] as const

export const runScenarioMetricsQueryAtomFamily = atomFamily((runId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const run = get(evaluationRunQueryAtomFamily(runId)).data
        const finished =
            Boolean(run) &&
            isTerminalRunStatus(run?.status) &&
            deriveEvaluationKind(run) !== "online"
        return {
            queryKey: runScenarioMetricsQueryKey(projectId ?? "", runId),
            queryFn: (): Promise<EvaluationMetric[]> =>
                queryRunScenarioMetrics({
                    projectId: projectId ?? "",
                    runId,
                    limit: SCENARIO_METRICS_LIMIT,
                }),
            enabled: Boolean(runId && projectId) && finished,
            staleTime: Infinity,
            retry: false,
        }
    }),
)

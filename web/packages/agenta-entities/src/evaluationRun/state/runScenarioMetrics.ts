/**
 * Every per-test-case metric row of one run and its failed step results, read when the run has
 * finished. The rows feed the "Passed" tile; the failed steps tell which test cases did not run
 * or have a failed evaluator. It does not poll: a running run would
 * send a large request every few seconds. Online runs never read it (one row per trace, no upper
 * bound). A save or a re-run on this page invalidates it.
 *
 * @packageDocumentation
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryRunFailedSteps, queryRunScenarioMetrics, type FailedStep} from "../api/runDetails"
import {
    deriveEvaluationKind,
    isTerminalRunStatus,
    SCENARIO_METRICS_LIMIT,
    type EvaluationMetric,
} from "../core"

import {evaluationRunQueryAtomFamily} from "./molecule"

export interface RunScenarioData {
    rows: EvaluationMetric[]
    failedSteps: FailedStep[]
}

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
            queryFn: async (): Promise<RunScenarioData> => {
                const args = {projectId: projectId ?? "", runId, limit: SCENARIO_METRICS_LIMIT}
                const [rows, failedSteps] = await Promise.all([
                    queryRunScenarioMetrics(args),
                    queryRunFailedSteps(args),
                ])
                return {rows, failedSteps}
            },
            enabled: Boolean(runId && projectId) && finished,
            // As stale as the run-level metrics: a save made elsewhere (an annotation queue) shows
            // when the overview opens again after 30 s. A window focus does not read it again.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: false,
        }
    }),
)

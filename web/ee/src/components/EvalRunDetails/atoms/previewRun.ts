import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {buildRunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"
import {getProjectValues} from "@/oss/state/project"

import {ACTIVE_RUN_REFETCH_INTERVAL, isActiveEvaluationStatus} from "./status"
import type {
    PreviewEvaluationRun,
    PreviewEvaluationRunQueryData,
    PreviewScenarioListQueryData,
    PreviewScenarioSummary,
} from "./types"

interface PreviewScenarioQueryResponse {
    count?: number
    scenarios: Record<string, unknown>[]
    windowing?: {
        next?: string | null
        start?: string | null
        stop?: string | null
        limit?: number | null
        order?: string | null
    } | null
}

export const activeEvaluationRunIdAtom = atom<string | null>(null)

export const previewEvaluationRunQueryAtom = atomWithQuery<PreviewEvaluationRunQueryData>((get) => {
    const runId = get(activeEvaluationRunIdAtom)
    const {projectId} = getProjectValues()

    return {
        queryKey: ["preview", "evaluation-run", runId, projectId],
        enabled: Boolean(runId && projectId),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        refetchInterval: (data) =>
            isActiveEvaluationStatus(data?.run?.status?.value)
                ? ACTIVE_RUN_REFETCH_INTERVAL
                : false,
        queryFn: async () => {
            if (!runId) {
                throw new Error("previewEvaluationRunQueryAtom requires a run id")
            }

            const response = await axios.get<{run: EvaluationRun}>(
                `/preview/evaluations/runs/${runId}`,
                {
                    params: {project_id: projectId},
                },
            )

            const rawRun = response.data?.run
            if (!rawRun) {
                throw new Error("Preview evaluation run payload is missing the run object")
            }

            const camelRun = snakeToCamelCaseKeys(rawRun) as PreviewEvaluationRun
            const runIndex = buildRunIndex(camelRun)
            const testsetIds = Array.from(
                new Set(
                    Object.values(runIndex.steps)
                        .map((meta) => meta?.refs?.testset?.id)
                        .filter((id): id is string => Boolean(id)),
                ),
            )

            return {
                rawRun,
                run: camelRun,
                runIndex,
                testsetIds,
            }
        },
    }
})

export const previewScenarioListQueryAtom = atomWithQuery<PreviewScenarioListQueryData>((get) => {
    const runId = get(activeEvaluationRunIdAtom)
    const {projectId} = getProjectValues()

    return {
        queryKey: ["preview", "evaluation-run", runId, "scenarios", projectId],
        enabled: Boolean(runId && projectId),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: 15_000,
        gcTime: 5 * 60 * 1000,
        queryFn: async () => {
            if (!runId) {
                throw new Error("previewScenarioListQueryAtom requires a run id")
            }

            const scenarios: PreviewScenarioSummary[] = []
            const FETCH_LIMIT = 200
            let cursor: string | null = null
            let total = 0

            // Loop through windowed pages until the API indicates completion or returns no rows
            for (let guard = 0; guard < 100; guard += 1) {
                const payload = {
                    scenario: {
                        run_id: runId,
                    },
                    windowing: {
                        next: cursor ?? undefined,
                        limit: FETCH_LIMIT,
                        order: "ascending",
                    },
                }

                const response = await axios.post<PreviewScenarioQueryResponse>(
                    `/preview/evaluations/scenarios/query`,
                    payload,
                    {
                        params: {
                            project_id: projectId,
                        },
                    },
                )

                const rawScenarios = Array.isArray(response.data?.scenarios)
                    ? response.data.scenarios
                    : []

                if (!rawScenarios.length) {
                    break
                }

                scenarios.push(
                    ...rawScenarios.map(
                        (scenario) => snakeToCamelCaseKeys(scenario) as PreviewScenarioSummary,
                    ),
                )

                total = Math.max(
                    total,
                    typeof response.data?.count === "number"
                        ? response.data.count
                        : scenarios.length,
                )

                cursor = (response.data?.windowing as any)?.next ?? null
                if (!cursor) {
                    break
                }
            }

            return {
                count: total || scenarios.length,
                scenarios,
            }
        },
    }
})

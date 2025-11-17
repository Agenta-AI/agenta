import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {buildRunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"
import {projectIdAtom} from "@/oss/state/project"

export interface EvaluationRunQueryResult {
    rawRun: EvaluationRun
    camelRun: any
    runIndex: ReturnType<typeof buildRunIndex>
}

interface EvaluationRunResponse {
    run: EvaluationRun
}

export const evaluationRunQueryAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluationRunQueryResult>((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["preview", "evaluation-run", runId, projectId],
            enabled: Boolean(runId && projectId),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!runId) {
                    throw new Error("evaluationRunQueryAtomFamily requires a run id")
                }
                const response = await axios.get<EvaluationRunResponse>(
                    `/preview/evaluations/runs/${runId}`,
                    {
                        params: {project_id: projectId},
                    },
                )
                const rawRun = response.data?.run
                if (!rawRun) {
                    throw new Error("Preview evaluation run payload missing")
                }
                const camelRun = snakeToCamelCaseKeys(rawRun)
                const runIndex = buildRunIndex(camelRun)
                return {rawRun, camelRun, runIndex}
            },
        }
    }),
)

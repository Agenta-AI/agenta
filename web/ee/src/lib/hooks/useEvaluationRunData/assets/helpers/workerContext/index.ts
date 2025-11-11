import {getOrgValues} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {WorkspaceMember} from "@/oss/lib/Types"
import {getJWT} from "@/oss/services/api"

import {RunIndex} from "../buildRunIndex"

import {EvalWorkerContextBase, WorkerAuthContext} from "./types"

/**
 * Build the evaluation-specific context for a worker fetch based on the current jotai store state.
 */
export const buildEvalWorkerContext = (params: {
    runId: string
    evaluation: EnrichedEvaluationRun
    runIndex: RunIndex
}): EvalWorkerContextBase => {
    const {selectedOrg} = getOrgValues()
    const members = (selectedOrg?.default_workspace?.members as WorkspaceMember[]) || []

    return {
        runId: params.runId,
        mappings: params.evaluation?.data?.mappings ?? [],
        members,
        evaluators: params.evaluation?.evaluators || [],
        testsets: params.evaluation?.testsets || [],
        variants: (params.evaluation?.variants || []).map((v) => ({
            ...v,
            // precompute optionalParameters to avoid metadata lookup in worker
            optionalParameters: transformToRequestBody({variant: v}),
        })),
        runIndex: params.runIndex,
    }
}

/**
 * Resolve JWT, apiUrl and projectId in a single place.
 */
export const buildAuthContext = async (): Promise<WorkerAuthContext> => {
    const jwt = (await getJWT()) || ""
    const apiUrl = getAgentaApiUrl()
    const projectId = getCurrentProject()?.projectId ?? ""
    return {jwt, apiUrl, projectId}
}

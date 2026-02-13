import axios from "@/oss/lib/api/assets/axiosConfig"
import {calcEvalDuration} from "@/oss/lib/evaluations/legacy"
import {assertValidId, isValidId} from "@/oss/lib/helpers/serviceValidations"
import {
    EvaluationStatus,
    KeyValuePair,
    LLMRunRateLimit,
    _Evaluation,
    _EvaluationScenario,
} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

// Re-export evaluator config functions from the canonical source
// This maintains backward compatibility for existing imports
export {
    fetchAllEvaluatorConfigs,
    createEvaluatorConfig,
    updateEvaluatorConfig,
    deleteEvaluatorConfig,
    type CreateEvaluatorConfigData,
} from "@/oss/services/evaluators"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

// Evaluations
const evaluationTransformer = (item: any) => ({
    id: item.id,
    appId: item.app_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    duration: calcEvalDuration(item),
    status: item.status,
    testset: {
        id: item.testset_id,
        name: item.testset_name,
    },
    user: {
        id: item.user_id,
        username: item.user_username,
    },
    variants: item.variant_ids.map((id: string, ix: number) => ({
        variantId: id,
        variantName: item.variant_names[ix],
    })),
    aggregated_results: item.aggregated_results || [],
    revisions: item.revisions,
    variant_revision_ids: item.variant_revision_ids,
    variant_ids: item.variant_ids,
    average_cost: item.average_cost,
    total_cost: item.total_cost,
    average_latency: item.average_latency,
})
export const fetchAllEvaluations = async (appId: string) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(`/evaluations?project_id=${projectId}`, {
        params: {app_id: appId},
    })
    return response.data.map(evaluationTransformer) as _Evaluation[]
}

export const fetchEvaluation = async (evaluationId: string) => {
    if (!isValidId(evaluationId)) {
        throw new Error("Invalid evaluationId parameter")
    }
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId)

    const response = await axios.get(`/evaluations/${encodeURIComponent(id)}`, {
        params: {project_id: projectId},
    })
    return evaluationTransformer(response.data) as _Evaluation
}

export const fetchEvaluationStatus = async (evaluationId: string) => {
    if (!isValidId(evaluationId)) {
        throw new Error("Invalid evaluationId parameter")
    }
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId)

    const response = await axios.get(`/evaluations/${encodeURIComponent(id)}/status`, {
        params: {project_id: projectId},
    })
    return response.data as {status: _Evaluation["status"]}
}

export type CreateEvaluationData =
    | {
          testset_id: string
          testset_revision_id?: string
          variant_ids?: string[]
          evaluator_ids: string[]
          rate_limit: LLMRunRateLimit
          lm_providers_keys?: KeyValuePair
          correct_answer_column: string
      }
    | {
          testset_id: string
          testset_revision_id?: string
          revisions_ids?: string[]
          evaluator_ids: string[]
          rate_limit: LLMRunRateLimit
          lm_providers_keys?: KeyValuePair
          correct_answer_column: string
          name: string
      }
export const createEvaluation = async (appId: string, evaluation: CreateEvaluationData) => {
    const {projectId} = getProjectValues()

    // TODO: new AUTO-EVAL trigger
    return await axios.post(`/evaluations/preview/start?project_id=${projectId}`, {
        ...evaluation,
        app_id: appId,
    })
    // return await axios.post(`/evaluations?project_id=${projectId}`, {...evaluation, app_id: appId})
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    const {projectId} = getProjectValues()

    return axios.delete(`/evaluations?project_id=${projectId}`, {
        data: {evaluations_ids: evaluationsIds},
    })
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (evaluationId: string) => {
    if (!isValidId(evaluationId)) {
        throw new Error("Invalid evaluationId parameter")
    }
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId)

    const [{data: evaluationScenarios}, evaluation] = await Promise.all([
        axios.get(`/evaluations/${encodeURIComponent(id)}/evaluation_scenarios`, {
            params: {project_id: projectId},
        }),
        fetchEvaluation(id),
    ])

    evaluationScenarios.forEach((scenario: _EvaluationScenario) => {
        scenario.evaluation = evaluation
        scenario.evaluators_configs = evaluation.aggregated_results.map(
            (item) => item.evaluator_config,
        )
    })
    return evaluationScenarios as _EvaluationScenario[]
}

export const updateScenarioStatus = async (
    scenario: _EvaluationScenario,
    status: EvaluationStatus,
) => {
    const {projectId} = getProjectValues()
    return axios.patch(`/preview/evaluations/scenarios/?project_id=${projectId}`, {
        scenarios: [{...scenario, status}],
    })
}

// Evaluation IDs by resource
export const fetchEvaluatonIdsByResource = async ({
    resourceIds,
    resourceType,
}: {
    resourceIds: string[]
    resourceType: "testset" | "evaluator_config" | "variant"
}) => {
    const {projectId} = getProjectValues()

    return axios.get(`/evaluations/by_resource?project_id=${projectId}`, {
        params: {resource_ids: resourceIds, resource_type: resourceType},
        paramsSerializer: {
            indexes: null, //no brackets in query params
        },
    })
}

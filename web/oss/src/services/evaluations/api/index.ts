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

    // Use preview API to query single evaluation by ID
    const response = await axios.post(`/preview/evaluations/runs/query?project_id=${projectId}`, {
        run: {
            ids: [id],
        },
    })

    const run = response.data?.runs?.[0]
    if (!run) {
        throw new Error("Evaluation not found")
    }

    // Transform preview run to legacy evaluation format
    return {
        id: run.id,
        appId: run.references?.find((r: any) => r.application)?.application?.id || run.meta?.app_id,
        created_at: run.created_at_timestamp,
        updated_at: run.updated_at_timestamp,
        duration: calcEvalDuration({
            created_at: run.created_at_timestamp,
            updated_at: run.updated_at_timestamp,
            status: run.status,
        }),
        status: run.status,
        testset: {
            id:
                run.references?.find((r: any) => r.testset)?.testset?.id ||
                run.meta?.testset_id ||
                "",
            name: run.meta?.testset_name || "Unknown",
        },
        user: {
            id: run.created_by_id || "",
            username: run.meta?.user_username || "Unknown",
        },
        variants:
            run.references
                ?.filter((r: any) => r.application_variant)
                ?.map((ref: any, ix: number) => ({
                    variantId: ref.application_variant?.id || "",
                    variantName: run.meta?.variant_names?.[ix] || "Unknown",
                })) || [],
        aggregated_results: run.meta?.aggregated_results || [],
        revisions:
            run.references
                ?.filter((r: any) => r.application_revision)
                ?.map((ref: any) => ref.application_revision?.id || "") || [],
        variant_revision_ids:
            run.references
                ?.filter((r: any) => r.application_revision)
                ?.map((ref: any) => ref.application_revision?.id || "") || [],
        variant_ids:
            run.references
                ?.filter((r: any) => r.application_variant)
                ?.map((ref: any) => ref.application_variant?.id || "") || [],
        average_cost: run.meta?.average_cost || 0,
        total_cost: run.meta?.total_cost || 0,
        average_latency: run.meta?.average_latency || 0,
    } as _Evaluation
}

export const fetchEvaluationStatus = async (evaluationId: string) => {
    if (!isValidId(evaluationId)) {
        throw new Error("Invalid evaluationId parameter")
    }
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId)

    // Use preview API to query single evaluation by ID
    const response = await axios.post(`/preview/evaluations/runs/query?project_id=${projectId}`, {
        run: {
            ids: [id],
        },
    })

    const run = response.data?.runs?.[0]
    if (!run) {
        throw new Error("Evaluation not found")
    }

    return {status: run.status} as {status: _Evaluation["status"]}
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

    // Determine which variant of the type we have and extract revision IDs
    const revisionIds =
        "revisions_ids" in evaluation
            ? evaluation.revisions_ids
            : "variant_ids" in evaluation
              ? evaluation.variant_ids
              : undefined
    const name = "name" in evaluation ? evaluation.name : "Evaluation" // Default name for legacy variant

    // Use simple evaluations endpoint which auto-starts execution
    return await axios.post(`/preview/simple/evaluations/?project_id=${projectId}`, {
        evaluation: {
            name,
            data: {
                // Simple evaluations API expects Target = Dict[UUID, Origin] for auto-evaluations
                testset_steps: evaluation.testset_revision_id
                    ? {[evaluation.testset_revision_id]: "auto"}
                    : undefined,
                application_steps:
                    revisionIds?.reduce(
                        (acc, id) => ({...acc, [id]: "auto"}),
                        {} as Record<string, "auto">,
                    ) || {},
                evaluator_steps: evaluation.evaluator_ids.reduce(
                    (acc, id) => ({...acc, [id]: "auto"}),
                    {} as Record<string, "auto">,
                ),
            },
            flags: {
                is_live: false,
                is_active: true,
                is_closed: false,
            },
        },
        jit: true,
    })
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    const {projectId} = getProjectValues()

    // Use preview API to delete runs
    return axios.delete(`/preview/evaluations/runs/?project_id=${projectId}`, {
        data: {run_ids: evaluationsIds},
    })
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (evaluationId: string) => {
    if (!isValidId(evaluationId)) {
        throw new Error("Invalid evaluationId parameter")
    }
    const {projectId} = getProjectValues()
    const id = assertValidId(evaluationId)

    // Fetch evaluation and scenarios in parallel using preview API
    const [{data: scenariosResponse}, evaluation] = await Promise.all([
        axios.post(`/preview/evaluations/scenarios/query?project_id=${projectId}`, {
            scenario: {
                references: [{evaluation_run: {id}}],
            },
        }),
        fetchEvaluation(id),
    ])

    const evaluationScenarios = scenariosResponse?.scenarios || []

    // Transform scenarios and attach evaluation metadata
    evaluationScenarios.forEach((scenario: any) => {
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

    // Build references filter based on resource type
    const references = resourceIds.map((id) => {
        switch (resourceType) {
            case "testset":
                return {testset: {id}}
            case "evaluator_config":
                return {evaluator: {id}}
            case "variant":
                return {application_variant: {id}}
            default:
                return {}
        }
    })

    // Use preview API to query runs by references
    const response = await axios.post(`/preview/evaluations/runs/query?project_id=${projectId}`, {
        run: {
            references,
        },
    })

    // Return evaluation IDs in same format as legacy endpoint
    return {
        data: response.data?.runs?.map((run: any) => run.id) || [],
    }
}

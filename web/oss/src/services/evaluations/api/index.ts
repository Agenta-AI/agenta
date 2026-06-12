import type {EvaluationConcurrencySettings} from "@/oss/components/pages/evaluations/NewEvaluation/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {calcEvalDuration} from "@/oss/lib/evaluations/legacy"
import {assertValidId, isValidId} from "@/oss/lib/helpers/serviceValidations"
import {EvaluationStatus, KeyValuePair, _Evaluation, _EvaluationScenario} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

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
    const response = await axios.post(`/evaluations/runs/query?project_id=${projectId}`, {
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
    const response = await axios.post(`/evaluations/runs/query?project_id=${projectId}`, {
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
          evaluator_revision_ids: string[]
          concurrency?: EvaluationConcurrencySettings
          lm_providers_keys?: KeyValuePair
      }
    | {
          testset_id: string
          testset_revision_id?: string
          revisions_ids?: string[]
          evaluator_revision_ids: string[]
          concurrency?: EvaluationConcurrencySettings
          lm_providers_keys?: KeyValuePair
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

    // One run per variant. A run carries exactly one application (invocation)
    // step: a run with multiple application steps is classified `not_planned`
    // (A/B comparisons must be separate evaluations) and never dispatches, so it
    // hangs in RUNNING forever. Fan out here so each variant becomes its own
    // supported testset -> application -> evaluator run.
    const applicationRevisionIds = revisionIds?.length ? revisionIds : [undefined]

    const evaluatorSteps = evaluation.evaluator_revision_ids.reduce(
        (acc, id) => ({...acc, [id]: "auto"}),
        {} as Record<string, "auto">,
    )
    const testsetSteps = evaluation.testset_revision_id
        ? {[evaluation.testset_revision_id]: "auto" as const}
        : undefined

    const responses = await Promise.all(
        applicationRevisionIds.map((revisionId) =>
            // Frontend provides revision IDs directly.
            axios.post(`/simple/evaluations/?project_id=${projectId}`, {
                evaluation: {
                    name,
                    data: {
                        // All steps use revision IDs directly.
                        testset_steps: testsetSteps,
                        application_steps: revisionId ? {[revisionId]: "auto"} : {},
                        evaluator_steps: evaluatorSteps,
                        concurrency: evaluation.concurrency ?? undefined,
                    },
                    flags: {
                        is_live: false,
                        is_active: true,
                        is_closed: false,
                    },
                },
            }),
        ),
    )

    // Callers read `.data.evaluation.id` off the result; return the first run so
    // that single-variant flows are unchanged, and expose the rest for callers
    // that want every created run.
    const [first, ...rest] = responses
    return Object.assign(first, {runs: responses, additionalRuns: rest})
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    const {projectId} = getProjectValues()

    // Use preview API to delete runs
    return axios.delete(`/evaluations/runs/?project_id=${projectId}`, {
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
        axios.post(`/evaluations/scenarios/query?project_id=${projectId}`, {
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
    return axios.patch(`/evaluations/scenarios/?project_id=${projectId}`, {
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

    const buildReference = (id: string) => {
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
    }

    // Query the preview API once per resource id: the backend matches references
    // with JSONB containment (AND semantics), so a single multi-reference query
    // would only find runs that use ALL of the resources at once.
    const responses = await Promise.all(
        resourceIds.map((id) =>
            axios.post(`/evaluations/runs/query?project_id=${projectId}`, {
                run: {
                    references: [buildReference(id)],
                },
            }),
        ),
    )

    const runIds = new Set<string>()
    for (const response of responses) {
        for (const run of response.data?.runs ?? []) {
            if (run?.id) runIds.add(run.id)
        }
    }

    // Return evaluation IDs in same format as legacy endpoint
    return {
        data: Array.from(runIds),
    }
}

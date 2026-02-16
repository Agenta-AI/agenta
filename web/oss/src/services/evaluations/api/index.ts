import uniqBy from "lodash/uniqBy"
import {v4 as uuidv4} from "uuid"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getTagColors} from "@/oss/lib/helpers/colors"
import {calcEvalDuration} from "@/oss/lib/helpers/evaluate"
import {assertValidId, isValidId} from "@/oss/lib/helpers/serviceValidations"
import {isDemo, stringToNumberInRange} from "@/oss/lib/helpers/utils"
import {
    ComparisonResultRow,
    EvaluationStatus,
    Evaluator,
    EvaluatorConfig,
    KeyValuePair,
    LLMRunRateLimit,
    Testset,
    _Evaluation,
    _EvaluationScenario,
} from "@/oss/lib/Types"
import aiImg from "@/oss/media/artificial-intelligence.png"
import bracketCurlyImg from "@/oss/media/bracket-curly.png"
import codeImg from "@/oss/media/browser.png"
import webhookImg from "@/oss/media/link.png"
import regexImg from "@/oss/media/programming.png"
import exactMatchImg from "@/oss/media/target.png"
import similarityImg from "@/oss/media/transparency.png"
import {fetchTestset} from "@/oss/services/testsets/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

const evaluatorIconsMap = {
    auto_exact_match: exactMatchImg,
    auto_similarity_match: similarityImg,
    auto_regex_test: regexImg,
    field_match_test: exactMatchImg,
    auto_webhook_test: webhookImg,
    auto_ai_critique: aiImg,
    auto_custom_code_run: codeImg,
    auto_json_diff: bracketCurlyImg,
    auto_semantic_similarity: similarityImg,
    auto_contains_json: bracketCurlyImg,
    rag_faithfulness: codeImg,
    rag_context_relevancy: codeImg,
}

//Evaluators
// export const fetchAllEvaluators = async () => {
//     const tagColors = getTagColors()
//     const {projectId} = getProjectValues()

//     const response = await axios.get(`/evaluators?project_id=${projectId}`)
//     const evaluators = (response.data || [])
//         .filter((item: Evaluator) => !item.key.startsWith("human"))
//         .filter((item: Evaluator) => isDemo() || item.oss)
//         .map((item: Evaluator) => ({
//             ...item,
//             icon_url: evaluatorIconsMap[item.key as keyof typeof evaluatorIconsMap],
//             color: tagColors[stringToNumberInRange(item.key, 0, tagColors.length - 1)],
//         })) as Evaluator[]

//     return evaluators
// }

// Evaluator Configs
export const fetchAllEvaluatorConfigs = async (
    appId?: string | null,
    projectIdOverride?: string | null,
) => {
    const tagColors = getTagColors()
    const {projectId: projectIdFromStore} = getProjectValues()
    const projectId = projectIdOverride ?? projectIdFromStore

    if (!projectId) {
        return [] as EvaluatorConfig[]
    }

    const response = await axios.get("/evaluators/configs", {
        params: {
            project_id: projectId,
            ...(appId ? {app_id: appId} : {}),
        },
    })
    const evaluatorConfigs = (response.data || []).map((item: EvaluatorConfig) => ({
        ...item,
        icon_url: evaluatorIconsMap[item.evaluator_key as keyof typeof evaluatorIconsMap],
        color: tagColors[stringToNumberInRange(item.evaluator_key, 0, tagColors.length - 1)],
    })) as EvaluatorConfig[]
    return evaluatorConfigs
}

export type CreateEvaluationConfigData = Omit<EvaluatorConfig, "id" | "created_at">
export const createEvaluatorConfig = async (
    appId: string | null | undefined,
    config: CreateEvaluationConfigData,
) => {
    const {projectId} = getProjectValues()
    void appId

    return axios.post(`/evaluators/configs?project_id=${projectId}`, {
        ...config,
    })
}

export const updateEvaluatorConfig = async (
    configId: string,
    config: Partial<CreateEvaluationConfigData>,
) => {
    const {projectId} = getProjectValues()

    return axios.put(`/evaluators/configs/${configId}?project_id=${projectId}`, config)
}

export const deleteEvaluatorConfig = async (configId: string) => {
    const {projectId} = getProjectValues()

    return axios.delete(`/evaluators/configs/${configId}?project_id=${projectId}`)
}

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
          variant_ids?: string[]
          evaluators_configs: string[]
          rate_limit: LLMRunRateLimit
          lm_providers_keys?: KeyValuePair
          correct_answer_column: string
      }
    | {
          testset_id: string
          revisions_ids?: string[]
          evaluators_configs: string[]
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

// Comparison
export const fetchAllComparisonResults = async (evaluationIds: string[]) => {
    // Defensive check: Only accept valid UUIDs
    const validIds = evaluationIds.filter((id) => isValidId(id))
    if (validIds.length === 0) {
        throw new Error("No valid evaluation IDs provided")
    }
    const scenarioGroups = await Promise.all(validIds.map(fetchAllEvaluationScenarios))
    const testset: Testset = await fetchTestset(scenarioGroups[0][0].evaluation?.testset?.id)

    const inputsNameSet = new Set<string>()
    scenarioGroups.forEach((group) => {
        group.forEach((scenario) => {
            scenario.inputs.forEach((input) => inputsNameSet.add(input.name))
        })
    })

    const rows: ComparisonResultRow[] = []
    const inputNames = Array.from(inputsNameSet)
    const inputValuesSet = new Set<string>()
    const variants = scenarioGroups.map((group) => group[0].evaluation.variants[0])
    const correctAnswers = uniqBy(
        scenarioGroups.map((group) => group[0].correct_answers).flat(),
        "key",
    )

    for (const data of testset.csvdata) {
        const inputValues = inputNames
            .filter((name) => data[name] !== undefined)
            .map((name) => ({name, value: data[name]}))
        const inputValuesStr = inputValues.map((ip) => ip.value).join("")
        if (inputValuesSet.has(inputValuesStr)) continue
        else inputValuesSet.add(inputValuesStr)

        rows.push({
            id: inputValuesStr,
            rowId: uuidv4(),
            inputs: inputNames
                .map((name) => ({name, value: data[name]}))
                .filter((ip) => ip.value !== undefined),
            ...correctAnswers.reduce((acc, curr) => {
                return {...acc, [`correctAnswer_${curr?.key}`]: data[curr?.key!]}
            }, {}),
            variants: variants.map((variant, ix) => {
                const group = scenarioGroups[ix]
                const scenario = group.find((scenario) =>
                    scenario.inputs.every((input) =>
                        inputValues.some(
                            (ip) => ip.name === input.name && ip.value === input.value,
                        ),
                    ),
                )
                return {
                    variantId: variant.variantId,
                    variantName: variant.variantName,
                    output: scenario?.outputs[0] || {
                        result: {type: "string", value: "", error: null},
                    },
                    evaluationId: scenario?.evaluation.id || "",
                    evaluatorConfigs: (scenario?.evaluators_configs || []).map((config) => ({
                        evaluatorConfig: config,
                        result: scenario?.results.find(
                            (result) => result.evaluator_config === config.id,
                        )?.result || {type: "string", value: "", error: null}, // Adjust this line
                    })),
                }
            }),
        })
    }

    return {
        rows,
        testset,
        evaluations: scenarioGroups.map((group) => group[0].evaluation),
    }
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

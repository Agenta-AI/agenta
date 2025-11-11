import uniqBy from "lodash/uniqBy"
import {v4 as uuidv4} from "uuid"

import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {
    ComparisonResultRow,
    EvaluationStatus,
    KeyValuePair,
    LLMRunRateLimit,
    TestSet,
    _Evaluation,
    _EvaluationScenario,
} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"

export const fetchEvaluation = async (evaluationId: string) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(`/evaluations/${evaluationId}?project_id=${projectId}`)
    return evaluationTransformer(response.data) as _Evaluation
}

export const fetchEvaluationStatus = async (evaluationId: string) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(`/evaluations/${evaluationId}/status?project_id=${projectId}`)
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
      }
export const createEvaluation = async (appId: string, evaluation: CreateEvaluationData) => {
    const {projectId} = getCurrentProject()

    // TODO: new AUTO-EVAL trigger
    return axios.post(`/api/evaluations/preview/start?project_id=${projectId}`, {
        ...evaluation,
        app_id: appId,
    })
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    const {projectId} = getCurrentProject()

    return axios.delete(`/evaluations?project_id=${projectId}`, {
        data: {evaluations_ids: evaluationsIds},
    })
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (evaluationId: string) => {
    const {projectId} = getCurrentProject()

    const [{data: evaluationScenarios}, evaluation] = await Promise.all([
        axios.get(`/evaluations/${evaluationId}/evaluation_scenarios?project_id=${projectId}`),
        fetchEvaluation(evaluationId),
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
    const {projectId} = getCurrentProject()
    return axios.patch(`/preview/evaluations/scenarios/?project_id=${projectId}`, {
        scenarios: [{...scenario, status}],
    })
}

// Comparison
export const fetchAllComparisonResults = async (evaluationIds: string[]) => {
    const scenarioGroups = await Promise.all(evaluationIds.map(fetchAllEvaluationScenarios))
    const testset: TestSet = await fetchTestset(scenarioGroups[0][0].evaluation?.testset?.id)

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
    const {projectId} = getCurrentProject()

    return axios.get(`/evaluations/by_resource?project_id=${projectId}`, {
        params: {resource_ids: resourceIds, resource_type: resourceType},
        paramsSerializer: {
            indexes: null, //no brackets in query params
        },
    })
}

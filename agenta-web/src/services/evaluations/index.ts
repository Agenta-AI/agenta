import axios from "@/lib//helpers/axiosConfig"
import {
    Annotation,
    AnnotationScenario,
    ComparisonResultRow,
    EvaluationStatus,
    Evaluator,
    EvaluatorConfig,
    KeyValuePair,
    LLMRunRateLimit,
    TestSet,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {getTagColors} from "@/lib/helpers/colors"
import {apiKeyObject, stringToNumberInRange} from "@/lib/helpers/utils"
import exactMatchImg from "@/media/target.png"
import similarityImg from "@/media/transparency.png"
import regexImg from "@/media/programming.png"
import webhookImg from "@/media/link.png"
import aiImg from "@/media/artificial-intelligence.png"
import codeImg from "@/media/browser.png"
import bracketCurlyImg from "@/media/bracket-curly.png"
import dayjs from "dayjs"
import {loadTestset} from "@/lib/services/api"
import {runningStatuses} from "@/components/pages/evaluations/cellRenderers/cellRenderers"
import {calcEvalDuration} from "@/lib/helpers/evaluate"

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
    auto_contains_json: bracketCurlyImg,
}

//Evaluators
export const fetchAllEvaluators = async () => {
    const tagColors = getTagColors()

    const response = await axios.get(`/api/evaluators/`)
    return (response.data || [])
        .filter((item: Evaluator) => !item.key.startsWith("human"))
        .map((item: Evaluator) => ({
            ...item,
            icon_url: evaluatorIconsMap[item.key as keyof typeof evaluatorIconsMap],
            color: tagColors[stringToNumberInRange(item.key, 0, tagColors.length - 1)],
        })) as Evaluator[]
}

// Evaluator Configs
export const fetchAllEvaluatorConfigs = async (appId: string) => {
    const response = await axios.get(`/api/evaluators/configs/`, {params: {app_id: appId}})
    return response.data as EvaluatorConfig[]
}

export type CreateEvaluationConfigData = Omit<EvaluatorConfig, "id" | "created_at">
export const createEvaluatorConfig = async (appId: string, config: CreateEvaluationConfigData) => {
    return axios.post(`/api/evaluators/configs/`, {...config, app_id: appId})
}

export const updateEvaluatorConfig = async (
    configId: string,
    config: Partial<CreateEvaluationConfigData>,
) => {
    return axios.put(`/api/evaluators/configs/${configId}/`, config)
}

export const deleteEvaluatorConfig = async (configId: string) => {
    return axios.delete(`/api/evaluators/configs/${configId}/`)
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
})
export const fetchAllEvaluations = async (appId: string) => {
    const response = await axios.get(`/api/evaluations/`, {params: {app_id: appId}})
    return response.data.map(evaluationTransformer) as _Evaluation[]
}

export const fetchEvaluation = async (evaluationId: string) => {
    const response = await axios.get(`/api/evaluations/${evaluationId}/`)
    return evaluationTransformer(response.data) as _Evaluation
}

export const fetchEvaluationStatus = async (evaluationId: string) => {
    const response = await axios.get(`/api/evaluations/${evaluationId}/status/`)
    return response.data as {status: _Evaluation["status"]}
}

export type CreateEvaluationData = {
    testset_id: string
    variant_ids: string[]
    evaluators_configs: string[]
    rate_limit: LLMRunRateLimit
    lm_providers_keys: KeyValuePair
    correct_answer_column: string
}
export const createEvalutaiton = async (appId: string, evaluation: CreateEvaluationData) => {
    return axios.post(`/api/evaluations/`, {...evaluation, app_id: appId})
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    return axios.delete(`/api/evaluations/`, {data: {evaluations_ids: evaluationsIds}})
}

export const reRunEvaluations = async (appId: string, evaluationsIds: string[]) => {
    return axios.post(
        `/api/evaluations/re-run/${evaluationsIds.join(",")}`,
        {lm_providers_keys: apiKeyObject()},
        {
            params: {app_id: appId},
        },
    )
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (evaluationId: string) => {
    const [{data: evaluationScenarios}, evaluation] = await Promise.all([
        axios.get(`/api/evaluations/${evaluationId}/evaluation_scenarios/`),
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

//annotations
export const fetchAllAnnotations = async (appId: string) => {
    const response = await axios.get(`/api/annotations/`, {params: {app_id: appId}})
    return response.data.map(evaluationTransformer) as Annotation[]
}

export const fetchAnnotation = async (annotationId: string) => {
    const response = await axios.get(`/api/annotations/${annotationId}/`)
    return evaluationTransformer(response.data) as unknown as Annotation
}

export const fetchAnnotationStatus = async (annotationId: string) => {
    const response = await axios.get(`/api/annotations/${annotationId}/status/`)
    return response.data as {status: EvaluationStatus}
}

export const createAnnotation = async (
    appId: string,
    annotation: Omit<CreateEvaluationData, "evaluators_configs"> &
        Pick<Annotation, "annotation_name">,
) => {
    return axios.post(`/api/annotations/`, {...annotation, app_id: appId})
}

export const deleteAnnotations = async (annotationsIds: string[]) => {
    return axios.delete(`/api/annotations/`, {data: {annotations_ids: annotationsIds}})
}

// Annotation Scenarios
export const fetchAllAnnotationScenarios = async (appId: string, annotationId: string) => {
    const [{data: annotationScenarios}, annotation] = await Promise.all([
        axios.get(`/api/annotations/${annotationId}/annotation_scenarios/`, {
            params: {app_id: appId},
        }),
        fetchAnnotation(annotationId),
    ])

    annotationScenarios.forEach((scenario: AnnotationScenario) => {
        scenario.annotation = annotation
    })
    return annotationScenarios as AnnotationScenario[]
}

export const updateAnnotationScenario = async (
    annotationId: string,
    annotationScenarioId: string,
    data: Pick<AnnotationScenario, "is_pinned" | "note" | "result">,
) => {
    return axios.put(
        `/api/annotations/${annotationId}/annotation_scenarios/${annotationScenarioId}`,
        data,
    )
}

// Comparison
export const fetchAllComparisonResults = async (evaluationIds: string[]) => {
    const scenarioGroups = await Promise.all(evaluationIds.map(fetchAllEvaluationScenarios))
    const testset: TestSet = await loadTestset(scenarioGroups[0][0].evaluation?.testset?.id)

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
    for (const data of testset.csvdata) {
        const inputValues = inputNames
            .filter((name) => data[name] !== undefined)
            .map((name) => ({name, value: data[name]}))
        const inputValuesStr = inputValues.map((ip) => ip.value).join("")
        if (inputValuesSet.has(inputValuesStr)) continue
        else inputValuesSet.add(inputValuesStr)

        rows.push({
            id: inputValuesStr,
            inputs: inputNames
                .map((name) => ({name, value: data[name]}))
                .filter((ip) => ip.value !== undefined),
            correctAnswer: data.correct_answer || "",
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
    appId,
}: {
    resourceIds: string[]
    resourceType: "testset" | "evaluator_config" | "variant"
    appId: string
}) => {
    return axios.get(`/api/evaluations/by_resource`, {
        params: {resource_ids: resourceIds, resource_type: resourceType, app_id: appId},
        paramsSerializer: {
            indexes: null, //no brackets in query params
        },
    })
}

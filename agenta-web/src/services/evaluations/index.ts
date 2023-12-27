import Mock from "@/components/pages/evaluations/evaluationResults/mock"
import axios from "@/lib//helpers/axiosConfig"
import {
    EvaluationStatus,
    Evaluator,
    EvaluatorConfig,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {getTagColors} from "@/lib/helpers/colors"
import {delay, stringToNumberInRange} from "@/lib/helpers/utils"
import exactMatchImg from "@/media/target.png"
import similarityImg from "@/media/transparency.png"
import regexImg from "@/media/programming.png"
import webhookImg from "@/media/link.png"
import aiImg from "@/media/artificial-intelligence.png"
import codeImg from "@/media/browser.png"
import dayjs from "dayjs"

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
    auto_webhook_test: webhookImg,
    auto_ai_critique: aiImg,
    auto_custom_code_run: codeImg,
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
    return axios.put(`/api/evaluators/configs/${configId}`, config)
}

export const deleteEvaluatorConfig = async (configId: string) => {
    return axios.delete(`/api/evaluators/configs/${configId}`)
}

// Evaluations
const evaluationTransformer = (item: any) => ({
    id: item.id,
    appId: item.app_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    duration: dayjs(item.updated_at).diff(dayjs(item.created_at), "milliseconds"),
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
    return response.data as {status: EvaluationStatus}
}

export type CreateEvaluationData = {
    testset_id: string
    variant_ids: string[]
    evaluators_configs: string[]
}
export const createEvalutaiton = async (appId: string, evaluation: CreateEvaluationData) => {
    return axios.post(`/api/evaluations/`, {...evaluation, app_id: appId})
}

export const deleteEvaluations = async (evaluationsIds: string[]) => {
    return axios.delete(`/api/evaluations/`, {data: {evaluations_ids: evaluationsIds}})
}

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (appId: string, evaluationId: string) => {
    // await delay(1000)
    // return Mock.evaluationScenarios

    const response = await axios.get(`/api/evaluations/${evaluationId}/evaluation_scenarios/`, {
        params: {app_id: appId},
    })
    return response.data as _EvaluationScenario[]
}

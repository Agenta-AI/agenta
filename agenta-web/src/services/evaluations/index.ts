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
import {delay, pickRandom, stringToNumberInRange} from "@/lib/helpers/utils"
import exactMatchImg from "@/media/target.png"
import similarityImg from "@/media/transparency.png"
import regexImg from "@/media/programming.png"
import webhookImg from "@/media/link.png"
import aiImg from "@/media/artificial-intelligence.png"
import codeImg from "@/media/browser.png"

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
    // await delay(1000)
    // return Mock.evaluators
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

export const deleteEvaluatorConfig = async (configId: string) => {
    return axios.delete(`/api/evaluators/configs/${configId}`)
}

// Evaluations
export const fetchAllEvaluations = async (appId: string) => {
    await delay(1000)
    return Mock.evaluations

    const response = await axios.get(`/api/evaluations/`, {params: {app_id: appId}})
    return response.data as _Evaluation[]
}

export const fetchEvaluation = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return Mock.evaluations[0]

    const response = await axios.get(`/api/evaluations/${evaluationId}/`, {
        params: {app_id: appId},
    })
    return response.data as _Evaluation
}

export const fetchEvaluationStatus = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return {status: pickRandom(Object.values(EvaluationStatus), 1)[0]}

    const response = await axios.get(`/api/evaluations/${evaluationId}/status/`, {
        params: {app_id: appId},
    })
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

// Evaluation Scenarios
export const fetchAllEvaluationScenarios = async (appId: string, evaluationId: string) => {
    await delay(1000)
    return Mock.evaluationScenarios

    const response = await axios.get(`/api/evaluations/${evaluationId}/evaluation_scenarios/`, {
        params: {app_id: appId},
    })
    return response.data as _EvaluationScenario[]
}

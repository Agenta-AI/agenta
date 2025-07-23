import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getTagColors} from "@/oss/lib/helpers/colors"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {isDemo, stringToNumberInRange} from "@/oss/lib/helpers/utils"
import {EvaluatorResponseDto} from "@/oss/lib/hooks/useEvaluators/types"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"
import aiImg from "@/oss/media/artificial-intelligence.png"
import bracketCurlyImg from "@/oss/media/bracket-curly.png"
import codeImg from "@/oss/media/browser.png"
import webhookImg from "@/oss/media/link.png"
import regexImg from "@/oss/media/programming.png"
import exactMatchImg from "@/oss/media/target.png"
import similarityImg from "@/oss/media/transparency.png"

//Prefix convention:
//  - create: POST data to server
export const createEvaluator = async (evaluatorPayload: EvaluatorResponseDto<"payload">) => {
    const {projectId} = getCurrentProject()

    try {
        const data = await axios.post(
            `${getAgentaApiUrl()}/preview/simple/evaluators/?project_id=${projectId}`,
            evaluatorPayload,
        )

        return data
    } catch (error) {
        throw error
    }
}

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
export const fetchAllEvaluators = async () => {
    const tagColors = getTagColors()
    const {projectId} = getCurrentProject()

    const response = await axios.get(`/evaluators?project_id=${projectId}`)
    const evaluators = (response.data || [])
        .filter((item: Evaluator) => !item.key.startsWith("human"))
        .filter((item: Evaluator) => isDemo() || item.oss)
        .map((item: Evaluator) => ({
            ...item,
            icon_url: evaluatorIconsMap[item.key as keyof typeof evaluatorIconsMap],
            color: tagColors[stringToNumberInRange(item.key, 0, tagColors.length - 1)],
        })) as Evaluator[]

    return evaluators
}

// Evaluator Configs
export const fetchAllEvaluatorConfigs = async (appId: string) => {
    const tagColors = getTagColors()
    const {projectId} = getCurrentProject()

    const response = await axios.get(`/evaluators/configs?project_id=${projectId}`, {
        params: {app_id: appId},
    })
    const evaluatorConfigs = (response.data || []).map((item: EvaluatorConfig) => ({
        ...item,
        icon_url: evaluatorIconsMap[item.evaluator_key as keyof typeof evaluatorIconsMap],
        color: tagColors[stringToNumberInRange(item.evaluator_key, 0, tagColors.length - 1)],
    })) as EvaluatorConfig[]
    return evaluatorConfigs
}

export type CreateEvaluationConfigData = Omit<EvaluatorConfig, "id" | "created_at">
export const createEvaluatorConfig = async (appId: string, config: CreateEvaluationConfigData) => {
    const {projectId} = getCurrentProject()

    return axios.post(`/evaluators/configs?project_id=${projectId}`, {
        ...config,
        app_id: appId,
    })
}

export const updateEvaluatorConfig = async (
    configId: string,
    config: Partial<CreateEvaluationConfigData>,
) => {
    const {projectId} = getCurrentProject()

    return axios.put(`/evaluators/configs/${configId}?project_id=${projectId}`, config)
}

export const deleteEvaluatorConfig = async (configId: string) => {
    const {projectId} = getCurrentProject()

    return axios.delete(`/evaluators/configs/${configId}?project_id=${projectId}`)
}

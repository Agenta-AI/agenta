import axios from "@/oss/lib/api/assets/axiosConfig"
import {
    buildEvaluatorSlug,
    buildEvaluatorUri,
    resolveEvaluatorKey,
} from "@/oss/lib/evaluators/utils"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getTagColors} from "@/oss/lib/helpers/colors"
import {isDemo, stringToNumberInRange} from "@/oss/lib/helpers/utils"
import {EvaluatorResponseDto} from "@/oss/lib/hooks/useEvaluators/types"
import {
    Evaluator,
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorData,
    SimpleEvaluatorEdit,
    SimpleEvaluatorResponse,
    SimpleEvaluatorsResponse,
} from "@/oss/lib/Types"
import aiImg from "@/oss/media/artificial-intelligence.png"
import bracketCurlyImg from "@/oss/media/bracket-curly.png"
import codeImg from "@/oss/media/browser.png"
import webhookImg from "@/oss/media/link.png"
import regexImg from "@/oss/media/programming.png"
import exactMatchImg from "@/oss/media/target.png"
import similarityImg from "@/oss/media/transparency.png"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - create: POST data to server
export const createEvaluator = async (evaluatorPayload: EvaluatorResponseDto<"payload">) => {
    const {projectId} = getProjectValues()

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

export const updateEvaluator = async (
    evaluatorId: string,
    evaluatorPayload: EvaluatorResponseDto<"payload">,
) => {
    const {projectId} = getProjectValues()

    try {
        const data = await axios.put(
            `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}?project_id=${projectId}`,
            evaluatorPayload,
        )

        return data
    } catch (error) {
        throw error
    }
}

export const fetchEvaluatorById = async (evaluatorId: string): Promise<SimpleEvaluator | null> => {
    const {projectId} = getProjectValues()
    if (!projectId) {
        return null
    }

    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}?project_id=${projectId}`,
    )
    const payload = (response?.data as any)?.evaluator ?? response?.data ?? null
    if (!payload) return null
    return decorateSimpleEvaluator(payload as SimpleEvaluator)
}

const evaluatorIconsMap = {
    auto_exact_match: exactMatchImg,
    auto_similarity_match: similarityImg,
    auto_regex_test: regexImg,
    field_match_test: exactMatchImg,
    json_multi_field_match: bracketCurlyImg,
    auto_webhook_test: webhookImg,
    auto_ai_critique: aiImg,
    auto_custom_code_run: codeImg,
    auto_json_diff: bracketCurlyImg,
    auto_semantic_similarity: similarityImg,
    auto_contains_json: bracketCurlyImg,
    // rag_faithfulness: codeImg,
    // rag_context_relevancy: codeImg,
}

//Evaluators
export const fetchAllEvaluators = async (includeArchived = false) => {
    const tagColors = getTagColors()
    const {projectId} = getProjectValues()

    const response = await axios.get(`/evaluators?project_id=${projectId}`)
    const evaluators = (response.data || [])
        .filter((item: Evaluator) => !item.key.startsWith("human"))
        .filter((item: Evaluator) => isDemo() || item.oss)
        .filter((item: Evaluator) => includeArchived || (item as any).archived !== true)
        // Deduplicate by key (keep first occurrence)
        .filter(
            (item: Evaluator, index: number, self: Evaluator[]) =>
                index === self.findIndex((e) => e.key === item.key),
        )
        .map((item: Evaluator) => ({
            ...item,
            icon_url: evaluatorIconsMap[item.key as keyof typeof evaluatorIconsMap],
            color: tagColors[stringToNumberInRange(item.key, 0, tagColors.length - 1)],
        })) as Evaluator[]

    return evaluators
}

// Evaluator Configs
function decorateSimpleEvaluator(evaluator: SimpleEvaluator) {
    const tagColors = getTagColors()
    const evaluatorKey = resolveEvaluatorKey(evaluator)
    if (!evaluatorKey) return evaluator

    return {
        ...evaluator,
        icon_url: evaluatorIconsMap[evaluatorKey as keyof typeof evaluatorIconsMap],
        color: tagColors[stringToNumberInRange(evaluatorKey, 0, tagColors.length - 1)],
    }
}

export const fetchAllEvaluatorConfigs = async (
    appId?: string | null,
    projectIdOverride?: string | null,
): Promise<SimpleEvaluator[]> => {
    const {projectId: projectIdFromStore} = getProjectValues()
    const projectId = projectIdOverride ?? projectIdFromStore
    void appId

    if (!projectId) {
        return [] as SimpleEvaluator[]
    }

    const response = await axios.post<SimpleEvaluatorsResponse>(
        `${getAgentaApiUrl()}/preview/simple/evaluators/query?project_id=${projectId}`,
        {
            include_archived: false,
        },
    )

    const evaluators = response.data?.evaluators ?? []
    return evaluators
        .filter((item) => !item.deleted_at)
        .filter((item) => item.flags?.is_human !== true)
        .map(decorateSimpleEvaluator)
}

export interface CreateEvaluatorConfigData {
    name: string
    evaluator_key: string
    parameters: Record<string, any>
    outputs_schema?: Record<string, any>
    tags?: string[]
    description?: string
}

export const createEvaluatorConfig = async (
    _appId: string | null | undefined,
    config: CreateEvaluatorConfigData,
): Promise<SimpleEvaluator> => {
    const {projectId} = getProjectValues()
    void _appId

    const data: SimpleEvaluatorData = {
        uri: buildEvaluatorUri(config.evaluator_key),
        parameters: config.parameters,
    }

    if (config.outputs_schema) {
        data.schemas = {
            outputs: config.outputs_schema,
        }
    }

    const payload: SimpleEvaluatorCreate = {
        slug: buildEvaluatorSlug(config.name),
        name: config.name,
        description: config.description,
        tags: config.tags,
        flags: {is_evaluator: true, is_human: false},
        data,
    }

    const response = await axios.post<SimpleEvaluatorResponse>(
        `${getAgentaApiUrl()}/preview/simple/evaluators/?project_id=${projectId}`,
        {evaluator: payload},
    )

    const evaluator = response.data?.evaluator
    if (!evaluator) {
        throw new Error("Failed to create evaluator")
    }

    return decorateSimpleEvaluator(evaluator)
}

export const updateEvaluatorConfig = async (
    configId: string,
    config: SimpleEvaluatorEdit,
): Promise<SimpleEvaluator> => {
    const {projectId} = getProjectValues()

    const response = await axios.put<SimpleEvaluatorResponse>(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${configId}?project_id=${projectId}`,
        {evaluator: {...config, id: configId}},
    )

    const evaluator = response.data?.evaluator
    if (!evaluator) {
        throw new Error("Failed to update evaluator")
    }

    return decorateSimpleEvaluator(evaluator)
}

export const deleteEvaluatorConfig = async (configId: string) => {
    const {projectId} = getProjectValues()

    return axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${configId}/archive?project_id=${projectId}`,
    )
}

export const deleteHumanEvaluator = async (evaluatorId: string) => {
    const {projectId} = getProjectValues()

    return axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${evaluatorId}/archive?project_id=${projectId}`,
    )
}

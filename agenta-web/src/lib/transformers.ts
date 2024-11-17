import {getAppValues} from "@/contexts/app.context"
import {
    BaseResponseSpans,
    Evaluation,
    EvaluationResponseType,
    GenericObject,
    Variant,
} from "./Types"
import {EvaluationType} from "./enums"
import {formatDay} from "./helpers/dateTimeHelper"
import {snakeToCamel} from "./helpers/utils"
import {TraceSpan} from "@/lib/Types"

export const fromEvaluationResponseToEvaluation = (item: EvaluationResponseType) => {
    const variants: Variant[] = item.variant_ids.map((variantId: string, ix) => {
        const variant = {
            variantId,
            variantName: item.variant_names[ix],
            templateVariantName: null,
            persistent: true,
            parameters: null,
        }
        return variant as Variant
    })

    const evaluationTypeSettings: GenericObject = {}
    for (const key in item.evaluation_type_settings) {
        evaluationTypeSettings[snakeToCamel(key)] =
            item.evaluation_type_settings[key as keyof typeof item.evaluation_type_settings]
    }

    const {apps} = getAppValues()

    return {
        id: item.id,
        createdAt: formatDay(item.created_at),
        user: {
            id: item.user_id,
            username: item.user_username,
        },
        variants,
        testset: {
            _id: item.testset_id,
            name: item.testset_name,
        },
        appName: apps.find((app) => app.app_id === item.app_id)?.app_name,
        status: item.status,
        evaluationType: item.evaluation_type,
        evaluationTypeSettings,
        llmAppPromptTemplate: item.evaluation_type_settings?.llm_app_prompt_template,
        revisions: item.revisions,
        variant_revision_ids: item.variants_revision_ids,
    } as Evaluation
}

export const fromEvaluationScenarioResponseToEvaluationScenario = (
    item: any,
    evaluation: Evaluation,
) => {
    let evaluationScenario: GenericObject = {
        id: item.id,
        inputs: item.inputs,
        outputs: item.outputs,
        correctAnswer: item.correct_answer,
        isPinned: item.is_pinned,
        note: item.note,
    }

    if (evaluation.evaluationType === EvaluationType.human_a_b_testing) {
        evaluationScenario = {...evaluationScenario, vote: item.vote}
    } else if (
        evaluation.evaluationType === EvaluationType.auto_exact_match ||
        evaluation.evaluationType === EvaluationType.auto_similarity_match ||
        evaluation.evaluationType === EvaluationType.auto_regex_test ||
        evaluation.evaluationType === EvaluationType.field_match_test ||
        evaluation.evaluationType === EvaluationType.auto_webhook_test ||
        evaluation.evaluationType === EvaluationType.auto_ai_critique ||
        evaluation.evaluationType === EvaluationType.single_model_test
    ) {
        evaluationScenario = {...evaluationScenario, score: item.score}
    }
    return evaluationScenario
}

export const abTestingEvaluationTransformer = ({
    item,
    results,
}: {
    item: EvaluationResponseType
    results: any
}) => ({
    key: item.id,
    createdAt: formatDay(item.created_at),
    variants: item.variant_ids,
    variantNames: item.variant_names,
    votesData: results.votes_data,
    evaluationType: item.evaluation_type,
    status: item.status,
    user: {
        id: item.user_id,
        username: item.user_username,
    },
    testset: {
        _id: item.testset_id,
        name: item.testset_name,
    },
    revisions: item.revisions,
    variant_revision_ids: item.variants_revision_ids,
})

export const singleModelTestEvaluationTransformer = ({
    item,
    result,
}: {
    item: Evaluation
    result: any
}) => ({
    key: item.id,
    createdAt: item.createdAt,
    variants: item.variants,
    scoresData: result.scores_data,
    evaluationType: item.evaluationType,
    status: item.status,
    testset: item.testset,
    custom_code_eval_id: item.evaluationTypeSettings.customCodeEvaluationId,
    resultsData: result.results_data,
    avgScore: result.avg_score,
    revisions: item.revisions,
    variant_revision_ids: item.variant_revision_ids,
})

export const transformTraceTreeToJson = (tree: TraceSpan[]) => {
    const nodeMap: Record<string, any> = {}

    function addTree(item: TraceSpan) {
        if (item.name) {
            const content = {
                ...item.content,
                ...(item.children ? transformTraceTreeToJson(item.children) : null),
            }

            if (!nodeMap[item.name]) {
                nodeMap[item.name] = content
            } else {
                if (!Array.isArray(nodeMap[item.name])) {
                    nodeMap[item.name] = [nodeMap[item.name]]
                }
                nodeMap[item.name].push(content)
            }
        }
    }

    tree.forEach((item) => {
        addTree(item)
    })

    const filterEmptyValues = (obj: Record<string, any>): any => {
        if (Array.isArray(obj)) {
            return obj
                .map(filterEmptyValues)
                .filter(
                    (item) =>
                        item !== null &&
                        !(typeof item === "object" && Object.keys(item).length === 0),
                )
        } else if (typeof obj === "object" && obj !== null) {
            return Object.entries(obj).reduce(
                (acc, [key, value]) => {
                    const filteredValue = filterEmptyValues(value)
                    if (
                        filteredValue !== null &&
                        !(
                            typeof filteredValue === "object" &&
                            Object.keys(filteredValue).length === 0
                        )
                    ) {
                        acc[key] = filteredValue
                    }
                    return acc
                },
                {} as Record<string, any>,
            )
        } else {
            return obj
        }
    }

    return filterEmptyValues(nodeMap)
}

export const generatePaths = (obj: Record<string, any>, currentPath = "") => {
    let paths: {value: string}[] = []

    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([key, value]) => {
            const newPath = currentPath ? `${currentPath}.${key}` : key
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    } else if (Array.isArray(obj)) {
        obj.forEach((value, index) => {
            const newPath = `${currentPath}[${index}]`
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    }

    return paths
}

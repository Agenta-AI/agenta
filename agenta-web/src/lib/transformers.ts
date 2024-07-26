import {getAppValues} from "@/contexts/app.context"
import {
    BaseResponseSpans,
    Evaluation,
    EvaluationResponseType,
    GenericObject,
    Variant,
} from "./Types"
import {EvaluationType} from "./enums"
import {formatDate} from "./helpers/dateTimeHelper"
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
        createdAt: formatDate(item.created_at),
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

export const fromBaseResponseToTraceSpanType = (
    spans: BaseResponseSpans[],
    traceId: string,
): TraceSpan[] => {
    return spans.map((span) => ({
        children: null,
        content: spans.reduce(
            (acc) => {
                if (span.inputs) {
                    let inputArr = Object.entries(span.inputs).map(([key, value]) => ({
                        input_name: key,
                        input_value: value,
                    }))

                    acc["inputs"] = inputArr
                }
                if (span.outputs) {
                    let outputArr = Object.values(span.outputs).map((value) =>
                        typeof value === "string" ? value : JSON.stringify(value),
                    )

                    acc["outputs"] = outputArr
                }
                acc["role"] = null // TODO: remove hardcoded role
                return acc
            },
            {} as {
                inputs: {input_name: string; input_value: string}[]
                outputs: string[]
                role: string | null
            },
        ),
        created_at: span.start_time,
        environment: span.environment || null,
        id: span.id,
        metadata: {
            cost: span.cost,
            latency: null, // TODO: remove hardcoded latency
            usage: span.tokens,
        },
        name: span.name,
        parent_span_id: span.parent_span_id,
        spankind: span.spankind,
        status: span.status,
        trace_id: traceId,
        user_id: span.user,
        variant: {
            revision: null, // TODO: remove hardcoded variant revision
            variant_id: span.variant_id || null,
            variant_name: span.variant_name || null,
        },
        config: span.config,
    }))
}

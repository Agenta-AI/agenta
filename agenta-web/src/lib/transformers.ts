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
import {getStringOrJson, snakeToCamel} from "./helpers/utils"
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
): [TraceSpan[], Record<string, TraceSpan>] => {
    const all_spans = spans.map((span) => ({
        id: span.id,
        name: span.name,
        created_at: span.start_time,
        variant: {
            variant_id: span.variant_id || null,
            variant_name: span.variant_name || null,

            revision:
                span.environment == "playground"
                    ? null
                    : span.config
                      ? span.config?.revision
                      : null,
        },
        environment: span.environment || null,
        spankind: span.spankind,
        status: span.status,
        metadata: {
            cost: span.cost,
            latency:
                (new Date(span.end_time).getTime() - new Date(span.start_time).getTime()) / 1000,
            usage: span.tokens,
        },
        content: spans.reduce(
            (acc) => {
                if (span.inputs) {
                    let inputArr = Object.entries(span.inputs).map(([key, value]) => ({
                        input_name: key,
                        input_value: value,
                    }))

                    acc["inputs"] = inputArr
                }
                if (span.internals) {
                    let internalArr = Object.entries(span.internals).map(([key, value]) => ({
                        internal_name: key,
                        internal_value: value,
                    }))

                    acc["internals"] = internalArr
                }
                if (span.outputs) {
                    if (typeof span.outputs === "string") {
                        acc["outputs"] = [span.outputs]
                    } else {
                        let outputArr = Object.values(span.outputs).map((value) =>
                            getStringOrJson(value),
                        )

                        acc["outputs"] = outputArr
                    }
                }
                acc["role"] = null

                return acc
            },
            {} as {
                inputs: {input_name: string; input_value: string}[] | null
                internals: {internal_name: string; internal_value: string}[] | null
                outputs: string[] | null
                role: string | null
            },
        ),
        user_id: span.user,
        trace_id: traceId,
        parent_span_id: span.parent_span_id,

        children: null,
    }))

    let spans_dict: Record<string, TraceSpan> = {}
    for (const span of all_spans) {
        spans_dict[span.id] = span
    }

    let child_spans: Array<string> = []

    for (const span of all_spans) {
        if (span.parent_span_id) {
            const parent_span: TraceSpan = spans_dict[span.parent_span_id]
            const child_span: TraceSpan = spans_dict[span.id]

            if (parent_span) {
                if (parent_span?.children === null) {
                    parent_span.children = []
                }

                parent_span.children?.push(child_span)
                child_spans.push(child_span.id)
            }
        }
    }

    const top_level_spans: Array<TraceSpan> = all_spans.filter(
        (span) => !child_spans.includes(span.id),
    )

    return [top_level_spans, spans_dict]
}

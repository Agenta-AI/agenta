import {getAppValues} from "@/contexts/app.context"
import {Evaluation, EvaluationResponseType, GenericObject, Variant} from "./Types"
import {EvaluationType} from "./enums"
import {formatDate} from "./helpers/dateTimeHelper"
import {snakeToCamel} from "./helpers/utils"

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
        llmAppPromptTemplate: item.evaluation_type_settings.llm_app_prompt_template,
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
    }

    if (evaluation.evaluationType === EvaluationType.human_a_b_testing) {
        evaluationScenario = {...evaluationScenario, vote: item.vote}
    } else if (
        evaluation.evaluationType === EvaluationType.auto_exact_match ||
        evaluation.evaluationType === EvaluationType.auto_similarity_match ||
        evaluation.evaluationType === EvaluationType.auto_regex_test ||
        evaluation.evaluationType === EvaluationType.auto_webhook_test ||
        evaluation.evaluationType === EvaluationType.auto_ai_critique
    ) {
        evaluationScenario = {...evaluationScenario, score: item.score}
    }
    return evaluationScenario
}

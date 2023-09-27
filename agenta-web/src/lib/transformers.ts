import {Evaluation, EvaluationResponseType, GenericObject, Variant} from "./Types"
import {EvaluationType} from "./enums"
import {formatDate} from "./helpers/dateTimeHelper"
import {snakeToCamel} from "./helpers/utils"

export const fromEvaluationResponseToEvaluation = (item: EvaluationResponseType) => {
    const variants: Variant[] = item.variants.map((variantId: string) => {
        const variant = {
            variantId,
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

    return {
        id: item.id,
        createdAt: formatDate(item.created_at),
        variants,
        testset: item.testset,
        appName: item.app_name,
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
        evaluation.evaluationType === EvaluationType.auto_webhook_test
    ) {
        evaluationScenario = {...evaluationScenario, score: item.score}
    } else if (evaluation.evaluationType === EvaluationType.auto_ai_critique) {
        evaluationScenario = {...evaluationScenario, evaluation: item.evaluation}
    }
    return evaluationScenario
}

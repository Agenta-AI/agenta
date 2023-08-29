import {Evaluation, EvaluationResponseType, GenericObject, Variant} from "./Types"
import {EvaluationType} from "./enums"
import {formatDate} from "./helpers/dateTimeHelper"

export const fromEvaluationResponseToEvaluation = (item: EvaluationResponseType) => {
    const variants: Variant[] = item.variants.map((variantName: string) => {
        const variant: Variant = {
            variantName: variantName,
            templateVariantName: null,
            persistent: true,
            parameters: null,
        }
        return variant
    })

    let evaluationTypeSettings: GenericObject = {}
    if (item.evaluation_type_settings?.similarity_threshold) {
        evaluationTypeSettings["similarityThreshold"] =
            item.evaluation_type_settings.similarity_threshold
    }

    return {
        id: item.id,
        createdAt: formatDate(item.created_at),
        variants: variants,
        testset: item.testset,
        appName: item.app_name,
        status: item.status,
        evaluationType: item.evaluation_type,
        evaluationTypeSettings: evaluationTypeSettings,
        llmAppPromptTemplate: item.llm_app_prompt_template,
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
        evaluation.evaluationType === EvaluationType.auto_similarity_match
    ) {
        evaluationScenario = {...evaluationScenario, score: item.score}
    } else if (evaluation.evaluationType === EvaluationType.auto_ai_critique) {
        evaluationScenario = {...evaluationScenario, evaluation: item.evaluation}
    }
    return evaluationScenario
}

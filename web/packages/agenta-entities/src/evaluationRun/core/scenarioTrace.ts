import type {EvaluationResult, EvaluationRunDataStep} from "./schema"

/**
 * The result that holds what a scenario annotates: the first result with a trace that is not an
 * annotation. An annotation result carries the annotation's own trace, and the API may list it
 * before the app's (or, for a trace queue, the input's).
 */
export function findScenarioTraceResult(
    results: EvaluationResult[],
    annotationSteps: EvaluationRunDataStep[],
): EvaluationResult | null {
    const annotationKeys = new Set(annotationSteps.map((step) => step.key))
    return results.find((result) => result.trace_id && !annotationKeys.has(result.step_key)) ?? null
}

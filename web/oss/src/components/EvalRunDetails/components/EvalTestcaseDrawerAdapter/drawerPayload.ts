export interface EvaluationDrawerPayload {
    // Explicit index signature keeps the payload assignable to Record<string, unknown>
    [key: string]: unknown
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    evaluators: Record<string, unknown>
    metrics: Record<string, unknown>
}

export function buildEvaluationDrawerPayload({
    inputs,
    outputs,
    evaluators,
    metrics,
}: EvaluationDrawerPayload): EvaluationDrawerPayload {
    return {
        inputs,
        outputs,
        evaluators,
        metrics,
    }
}

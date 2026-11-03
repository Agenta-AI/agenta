export type QueueKind = "traces" | "testcases"

export interface SelectedEvaluator {
    evaluatorId: string
    revisionId: string
    evaluatorName: string
    version: number
    isHuman: boolean
}

export interface CreateQueueValues {
    name: string
    kind: QueueKind
    description: string
    evaluators: SelectedEvaluator[]
}

export interface CreateQueueErrors {
    name?: string
    kind?: string
    evaluators?: string
}

/** Errors for the current values. The form shows them after the first submit. */
export const validateCreateQueue = (values: CreateQueueValues): CreateQueueErrors => {
    const errors: CreateQueueErrors = {}
    if (!values.name.trim()) errors.name = "Name is required"
    if (!values.kind) errors.kind = "Type is required"
    if (values.evaluators.length === 0) errors.evaluators = "At least one evaluator is required"
    return errors
}

import type {Workflow} from "@agenta/entities/workflow"

import type {Testset as BaseTestset} from "@/oss/lib/Types"
import {EvaluatorDto} from "@/oss/services/evaluations/api/evaluatorTypes"

// Extend the base Testset to include optional variantId and revisionId
export interface Testset extends BaseTestset {
    variantId?: string
    revisionId?: string
}

export interface CreateEvaluationRunInput {
    name: string
    testset: Testset | testset | undefined
    revisions: Workflow[]
    evaluators?: EvaluatorDto[]
    correctAnswerColumn: string
    meta?: Record<string, any>
}

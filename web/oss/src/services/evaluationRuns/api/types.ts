import type {Workflow} from "@agenta/entities/workflow"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import type {Testset as BaseTestset} from "@/oss/lib/Types"

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

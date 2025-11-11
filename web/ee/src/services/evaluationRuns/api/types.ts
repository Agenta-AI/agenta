import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {TestSet as BaseTestSet} from "@/oss/lib/Types"

// Extend the base TestSet to include optional variantId and revisionId
export interface TestSet extends BaseTestSet {
    variantId?: string
    revisionId?: string
}

export interface CreateEvaluationRunInput {
    name: string
    testset: TestSet | testset | undefined
    revisions: EnhancedVariant[]
    evaluators?: EvaluatorDto[]
    correctAnswerColumn: string
    meta?: Record<string, any> // Optional meta object to include in each run
}

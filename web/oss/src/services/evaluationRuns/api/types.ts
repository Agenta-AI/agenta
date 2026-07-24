import type {Workflow} from "@agenta/entities/workflow"

import type {Testset as BaseTestset} from "@/oss/lib/Types"

// Extend the base Testset to include optional variantId and revisionId
export interface Testset extends BaseTestset {
    variantId?: string
    revisionId?: string
    slug?: string
    // Populated by revision hydration in usePreviewEvaluations.createNewRun.
    data?: {
        testcaseIds?: string[]
        testcases?: {id: string; data?: Record<string, unknown>}[]
    }
}

export interface CreateEvaluationRunInput {
    name: string
    testset: Testset | undefined
    revisions: Workflow[]
    evaluators?: Workflow[]
    correctAnswerColumn: string
    meta?: Record<string, any>
}

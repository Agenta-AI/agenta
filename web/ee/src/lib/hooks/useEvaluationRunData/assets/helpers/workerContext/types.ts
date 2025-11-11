import type {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {PreviewTestSet, WorkspaceMember} from "@/oss/lib/Types"

import {RunIndex} from "../buildRunIndex"

/**
 * Minimal context object that the evaluation worker expects for enrichment.
 * It purposefully contains only clone-safe data (no functions, Dates, etc.).
 */
export interface EvalWorkerContextBase {
    runId: string
    mappings: unknown[]
    members: WorkspaceMember[]
    evaluators: EvaluatorDto[]
    testsets: PreviewTestSet[]
    variants: EnhancedVariant[]
    runIndex: RunIndex
}

/**
 * Authentication / environment info passed separately to the worker.
 */
export interface WorkerAuthContext {
    jwt: string
    apiUrl: string
    projectId: string
}

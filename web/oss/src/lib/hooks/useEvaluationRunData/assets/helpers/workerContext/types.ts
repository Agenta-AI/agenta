import type {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import type {PreviewTestset, WorkspaceMember} from "@/oss/lib/Types"

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
    testsets: PreviewTestset[]
    variants: EnhancedVariant[]
    runIndex: RunIndex
    uriObject?: {runtimePrefix: string; routePath?: string}
    /** Stable transformed parameters keyed by revision id */
    parametersByRevisionId?: Record<string, any>
}

/**
 * Authentication / environment info passed separately to the worker.
 */
export interface WorkerAuthContext {
    jwt: string
    apiUrl: string
    projectId: string
}

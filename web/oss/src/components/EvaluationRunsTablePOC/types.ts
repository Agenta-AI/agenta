import type {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable/types"
import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"
import type {SnakeToCamelCaseKeys} from "@/oss/lib/Types"

import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"

// The original `@/oss/state/evaluations/legacyAtoms` module no longer exists, and `legacy`
// is only ever read through `any` casts — represented as an opaque record (per WP-4i).
export type LegacyAutoEvaluation = Record<string, unknown>

export type PreviewEvaluationRun = SnakeToCamelCaseKeys<EvaluationRun>

export type EvaluationRunSource = "preview" | "legacy"
export type EvaluationRunKind = "auto" | "human" | "online" | "custom" | "all"
export type ConcreteEvaluationRunKind = Exclude<EvaluationRunKind, "all">

export interface PreviewRunColumnMeta {
    steps: {
        key: string
        type?: string | null
        origin?: string | null
        references?: Record<string, unknown> | null
    }[]
    mappings: {
        kind?: string | null
        name?: string | null
        stepKey?: string | null
        path?: string | null
        outputType?: string | null
    }[]
    evaluators?: {
        id?: string | null
        slug?: string | null
        name?: string | null
    }[]
}

export interface EvaluationRunApiRow {
    key: string
    source: EvaluationRunSource
    projectId: string | null
    runId: string | null
    createdAt?: string | null
    status?: string | null
    appId?: string | null
    legacy?: LegacyAutoEvaluation
    preview?: {id: string}
    previewMeta?: PreviewRunColumnMeta | null
    evaluationKind?: ConcreteEvaluationRunKind
}

export interface EvaluationRunTableRow extends InfiniteTableRowBase {
    key: string
    source: EvaluationRunSource
    projectId: string | null
    runId: string | null
    createdAt?: string | null
    status?: string | null
    appId?: string | null
    legacy?: LegacyAutoEvaluation
    preview?: {id: string}
    previewMeta?: PreviewRunColumnMeta | null
    __isSkeleton: boolean
    evaluationKind?: ConcreteEvaluationRunKind
    [key: string]: unknown
}

export interface EvaluationRunsWindowResult {
    rows: EvaluationRunApiRow[]
    totalCount: number | null
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
    /**
     * Per-page stats for the run-list **subject** predicate (the structural
     * "is this run an evaluation of the scoped workflow?" filter). Feeds the
     * hit-ratio meter: when the rolling pass-ratio is low, the scoped workflow
     * is being graded far more often than it's evaluated, signalling the
     * backend role-aware reference filter (v2) is warranted. Absent when no
     * subject filter is active (project scope).
     */
    subjectFilterStats?: {
        /** Runs reaching the subject check (already past kind/status/search). */
        scanned: number
        /** Of those, runs whose subject is the scoped workflow. */
        matched: number
    }
}

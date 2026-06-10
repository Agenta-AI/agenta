import type {SnakeToCamelCaseKeys} from "@agenta/shared/types"
import type {InfiniteTableRowBase, WindowingState} from "@agenta/ui/table"

import type {EvaluationRun} from "../../hooks"

/**
 * Legacy auto-evaluation payload carried on a row's `legacy` slot.
 *
 * The runs-table only ever reads `legacy` through an `any` cast (e.g. `(row.legacy as any)
 * ?.name`), so the precise legacy shape is irrelevant here. The original OSS import
 * (`@/oss/state/evaluations/legacyAtoms`) pointed at a module that no longer exists, so it
 * is represented here as an opaque record to keep the data layer free of `@/oss` and free
 * of the dangling import.
 */
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
}

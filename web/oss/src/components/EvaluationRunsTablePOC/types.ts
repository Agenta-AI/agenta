import type {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable/types"
import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"
import type {SnakeToCamelCaseKeys} from "@/oss/lib/Types"

import type {LegacyAutoEvaluation} from "../../state/evaluations/legacyAtoms"

import type {EvaluationRun} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/types"

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

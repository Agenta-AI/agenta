import type {EvaluationRunKind, EvaluationRunTableRow} from "../../types"

export interface UseEvaluationRunsColumnsParams {
    evaluationKind: EvaluationRunKind
    rows: EvaluationRunTableRow[]
    scopeId: string | null
    supportsPreviewMetrics: boolean
    isAutoOrHuman: boolean
    onOpenDetails: (record: EvaluationRunTableRow) => void
    onVariantNavigation: (params: {revisionId: string; appId?: string | null}) => void
    onTestsetNavigation: (testsetId: string) => void
    onRequestDelete: (record: EvaluationRunTableRow) => void
    resolveAppId: (record: EvaluationRunTableRow) => string | null
    onExportRow?: (record: EvaluationRunTableRow) => void
    rowExportingKey?: string | null
}

export type RecordPath = readonly (string | number)[]

export interface EvaluatorHandles {
    slug?: string | null
    name?: string | null
    id?: string | null
    variantId?: string | null
    variantSlug?: string | null
    revisionId?: string | null
    revisionSlug?: string | null
    projectId?: string | null
}

export interface EvaluatorReferenceCandidate {
    slug?: string | null
    key?: string | null
    id?: string | null
    name?: string | null
}

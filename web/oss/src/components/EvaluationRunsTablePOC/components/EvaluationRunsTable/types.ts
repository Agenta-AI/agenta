import {type EvaluationRunKind} from "../../types"

export interface EvaluationRunsTableProps {
    appId?: string | null
    projectIdOverride?: string | null
    includePreview?: boolean
    pageSize?: number
    evaluationKind: EvaluationRunKind
    className?: string
    active?: boolean
    showFilters?: boolean
    enableInfiniteScroll?: boolean
    autoHeight?: boolean
    headerTitle?: React.ReactNode
    manageContextOverrides?: boolean
}

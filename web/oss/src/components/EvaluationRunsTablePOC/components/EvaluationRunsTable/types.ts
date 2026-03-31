import type {TableTabsConfig} from "@/oss/components/InfiniteVirtualTable"

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
    /** Tabs configuration for the header */
    tabs?: TableTabsConfig
    /** @deprecated Use tabs prop instead. Additional content to render in the header row */
    headerExtra?: React.ReactNode
    manageContextOverrides?: boolean
    hideOnboardingVideos?: boolean
}

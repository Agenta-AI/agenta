import type {
    RunIndex,
    ColumnDef,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvaluationStatus} from "@/oss/lib/Types"

// ---------------- Helpers ------------------
export const titleCase = (str: string) =>
    String(str || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[a-z]|\s[a-z]/g, (m) => m.toUpperCase())

// --------------------- Main Builder ---------------------

export interface BuildFlatArgs {
    scenarioIds: string[]
    statusMap: Record<string, {status: EvaluationStatus; result?: any} | undefined>
    allScenariosLoaded: boolean
    runIndex: RunIndex | null | undefined
    evaluators: any[]
    metricValuesMap: Record<string, Record<string, any>>
    skeletonCount?: number
}

/**
 * Build a *flat* data source where each row already contains every cell value.
 * Columns are generated alongside with minimal metadata.
 */
// --------------------------------------------------
// Ant Design column helper for flat data rows
// --------------------------------------------------

type ExtendedColumnDef = Omit<ColumnDef, "kind"> & {kind: string; path: string}

import type {ColumnDefs} from "@agenta/ui/table"

export interface ObservabilityHeaderProps {
    /** Only the CSV export pipeline reads this — it derives the header row from the column titles. */
    columns: ColumnDefs<any>
    componentType: "traces" | "sessions"
    isLoading?: boolean
    onRefresh?: () => void | Promise<void>
    refreshTrigger?: number
}

import {memo, type ReactNode} from "react"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"

interface TraceDataDrillInProps {
    /** The span ID to display */
    spanId: string
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Whether editing is enabled (default: false) */
    editable?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column - receives the full data path and selected column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping - receives the full data path */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication and display) */
    mappedPaths?: Map<string, string>
    /** Path to focus/navigate to (e.g., "data.inputs.prompt") */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked in nested JSON editors */
    onPropertyClick?: (path: string) => void
}

/**
 * Drill-in viewer for trace data.
 * Thin wrapper around TraceSpanDrillInView for backward compatibility.
 */
const TraceDataDrillIn = memo((props: TraceDataDrillInProps) => {
    return <TraceSpanDrillInView {...props} />
})

TraceDataDrillIn.displayName = "TraceDataDrillIn"

export default TraceDataDrillIn

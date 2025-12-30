import {memo, type ReactNode} from "react"

import {
    getTraceSpanValueAtPath,
    getTraceSpanRootItems,
    traceSpanSetValueAtPathAtom,
    traceSpanWithDraftAtomFamily,
} from "@/oss/state/entities/trace/drillInState"

import {EntityDrillInView} from "./EntityDrillInView"
import type {DrillInContentProps} from "./DrillInContent"

// ============================================================================
// TYPES
// ============================================================================

export interface TraceSpanDrillInViewProps
    extends Omit<
        DrillInContentProps,
        "getValue" | "setValue" | "getRootItems" | "valueMode"
    > {
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
    /** Initial path to start navigation at (e.g., "inputs.prompt" or ["inputs", "prompt"]) */
    initialPath?: string | string[]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Drill-in viewer for trace span data.
 * Wrapper around EntityDrillInView that provides trace-specific configuration.
 *
 * This component handles:
 * - Reading span from entity atoms (includes draft if exists)
 * - Writing updates via trace span atoms
 * - Attribute-based field structure
 * - Native value serialization (no string conversion)
 */
export const TraceSpanDrillInView = memo(
    ({
        spanId,
        title = "data",
        breadcrumbPrefix,
        showBackArrow = true,
        editable = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        mappedPaths,
        focusPath,
        onFocusPathHandled,
        onPropertyClick,
        initialPath,
    }: TraceSpanDrillInViewProps) => {
        return (
            <EntityDrillInView
                entityId={spanId}
                entityAtomFamily={traceSpanWithDraftAtomFamily}
                getValueAtPath={getTraceSpanValueAtPath}
                setValueAtPathAtom={traceSpanSetValueAtPathAtom}
                getRootItems={getTraceSpanRootItems}
                valueMode="native"
                rootTitle={title}
                breadcrumbPrefix={breadcrumbPrefix}
                showBackArrow={showBackArrow}
                editable={editable}
                showAddControls={false}
                showDeleteControls={false}
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                mappedPaths={mappedPaths}
                focusPath={focusPath}
                onFocusPathHandled={onFocusPathHandled}
                onPropertyClick={onPropertyClick}
                initialPath={initialPath}
            />
        )
    },
)

TraceSpanDrillInView.displayName = "TraceSpanDrillInView"

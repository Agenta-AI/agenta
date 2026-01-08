import {memo, type ReactNode} from "react"

import {traceSpan} from "@/oss/state/entities/trace"

import type {DrillInContentProps} from "./DrillInContent"
import {EntityDrillInView} from "./EntityDrillInView"

// ============================================================================
// TYPES
// ============================================================================

export interface TraceSpanDrillInViewProps
    extends Omit<DrillInContentProps, "getValue" | "setValue" | "getRootItems" | "valueMode"> {
    /** The span ID to display */
    spanId: string
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Whether editing is enabled (default: false for traces) */
    editable?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication) */
    mappedPaths?: Map<string, string>
    /** Path to focus/navigate to (e.g., "data.inputs.prompt") */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked */
    onPropertyClick?: (path: string) => void
    /** Initial path to start navigation at */
    initialPath?: string | string[]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Drill-in viewer for trace span data.
 *
 * Uses the unified traceSpan entity API for all state management.
 * This is a thin wrapper that passes the trace controller to EntityDrillInView.
 *
 * Default behavior for traces:
 * - Read-only (editable=false)
 * - No add/delete controls
 * - Root title is "data"
 *
 * @example
 * ```tsx
 * // Read-only trace viewing with column mapping
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   columnOptions={columnOptions}
 *   onMapToColumn={handleMap}
 *   mappedPaths={mappedPaths}
 * />
 *
 * // Editable trace
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   editable={true}
 * />
 * ```
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
        // Type assertion needed because traceSpan.drillIn is optional in the general type
        // but we know it's configured for the trace entity
        const entityWithDrillIn = traceSpan as typeof traceSpan & {
            drillIn: NonNullable<typeof traceSpan.drillIn>
        }

        return (
            <EntityDrillInView
                entityId={spanId}
                entity={entityWithDrillIn}
                // Trace-specific defaults
                rootTitle={title}
                editable={editable}
                showAddControls={false}
                showDeleteControls={false}
                // Navigation props
                breadcrumbPrefix={breadcrumbPrefix}
                showBackArrow={showBackArrow}
                initialPath={initialPath}
                focusPath={focusPath}
                onFocusPathHandled={onFocusPathHandled}
                onPropertyClick={onPropertyClick}
                // Column mapping props (for AddToTestsetDrawer integration)
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                mappedPaths={mappedPaths}
            />
        )
    },
)

TraceSpanDrillInView.displayName = "TraceSpanDrillInView"

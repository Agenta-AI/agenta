import {memo, type ReactNode, useCallback} from "react"

import {DrillInContent, type PathItem} from "@/oss/components/DrillInView"

interface TraceDataDrillInProps {
    /** The trace data object to display */
    data: Record<string, unknown>
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Callback when data is changed - receives the full updated data object */
    onDataChange?: (data: Record<string, unknown>) => void
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
 * Uses shared DrillInContent component for consistent behavior across the app.
 */
const TraceDataDrillIn = memo(
    ({
        data,
        title = "data",
        breadcrumbPrefix,
        showBackArrow = true,
        onDataChange,
        editable = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        mappedPaths,
        focusPath,
        onFocusPathHandled,
        onPropertyClick,
    }: TraceDataDrillInProps) => {
        // Get value at path (native mode - works with actual types)
        // Handles stringified JSON values by parsing them when navigating deeper
        const getValue = useCallback(
            (path: string[]): unknown => {
                let current: unknown = data
                for (const key of path) {
                    if (current === null || current === undefined) return undefined

                    // If current is a string, try to parse it as JSON before navigating
                    if (typeof current === "string") {
                        try {
                            current = JSON.parse(current)
                        } catch {
                            // Not valid JSON, can't navigate further
                            return undefined
                        }
                    }

                    if (Array.isArray(current)) {
                        const index = parseInt(key, 10)
                        current = current[index]
                    } else if (typeof current === "object") {
                        current = (current as Record<string, unknown>)[key]
                    } else {
                        return undefined
                    }
                }
                return current
            },
            [data],
        )

        // Update value at path
        // Handles stringified JSON values by parsing, updating, and re-stringifying
        const setValue = useCallback(
            (path: string[], newValue: unknown) => {
                if (!onDataChange) return

                const updateNested = (obj: unknown, keys: string[], value: unknown): unknown => {
                    if (keys.length === 0) return value
                    const [key, ...rest] = keys

                    // If obj is a string, try to parse it as JSON, update, and re-stringify
                    if (typeof obj === "string") {
                        try {
                            const parsed = JSON.parse(obj)
                            const updated = updateNested(parsed, keys, value)
                            // Re-stringify with same formatting (detect if original was formatted)
                            const hasFormatting = obj.includes("\n") || obj.includes("  ")
                            return hasFormatting
                                ? JSON.stringify(updated, null, 2)
                                : JSON.stringify(updated)
                        } catch {
                            // Not valid JSON, can't update
                            return obj
                        }
                    }

                    if (Array.isArray(obj)) {
                        const index = parseInt(key, 10)
                        const newArr = [...obj]
                        newArr[index] = updateNested(obj[index], rest, value)
                        return newArr
                    } else if (typeof obj === "object" && obj !== null) {
                        return {
                            ...(obj as Record<string, unknown>),
                            [key]: updateNested((obj as Record<string, unknown>)[key], rest, value),
                        }
                    }
                    return value
                }

                const updatedData = updateNested(data, path, newValue) as Record<string, unknown>
                onDataChange(updatedData)
            },
            [data, onDataChange],
        )

        // Get root items (all top-level properties of data)
        const getRootItems = useCallback((): PathItem[] => {
            return Object.keys(data)
                .sort()
                .map((key) => ({
                    key,
                    name: key,
                    value: data[key],
                    isColumn: false,
                }))
        }, [data])

        return (
            <DrillInContent
                getValue={getValue}
                setValue={setValue}
                getRootItems={getRootItems}
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
                valueMode="native"
            />
        )
    },
)

TraceDataDrillIn.displayName = "TraceDataDrillIn"

export default TraceDataDrillIn

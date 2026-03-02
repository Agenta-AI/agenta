import {createContext, useContext} from "react"

import type {RowHeightSize} from "../hooks/useRowHeight"

/**
 * Row height context value
 */
export interface RowHeightContextValue {
    /** Current row height size (small/medium/large) */
    size: RowHeightSize
    /** Current row height in pixels */
    heightPx: number
    /** Max lines to show in cells for content truncation */
    maxLines: number
}

/**
 * Default context value (medium size)
 */
const DEFAULT_ROW_HEIGHT_CONTEXT: RowHeightContextValue = {
    size: "medium",
    heightPx: 160,
    maxLines: 10,
}

/**
 * Context for row height configuration.
 * Provided by InfiniteVirtualTableFeatureShell when rowHeightConfig is set.
 * Consumed by cell components to get the current maxLines for content truncation.
 */
export const RowHeightContext = createContext<RowHeightContextValue>(DEFAULT_ROW_HEIGHT_CONTEXT)

/**
 * Hook to access the current row height configuration from context.
 * Use this in cell components to get the correct maxLines for content truncation.
 *
 * @example
 * ```tsx
 * function MyCell({ value }) {
 *     const { maxLines } = useRowHeightContext()
 *     return <SmartCellContent value={value} maxLines={maxLines} />
 * }
 * ```
 */
export function useRowHeightContext(): RowHeightContextValue {
    return useContext(RowHeightContext)
}

/**
 * TableEmptyState Component
 *
 * A reusable empty state component for tables.
 * Displays a centered message when no data is available.
 *
 * @example
 * ```typescript
 * import { TableEmptyState } from '@agenta/ui'
 *
 * if (!isLoading && rows.length === 0) {
 *   return <TableEmptyState message="No testcases found" />
 * }
 * ```
 */

import {cn, flexLayouts, justifyClasses} from "../../../utils/styles"
import {EmptyState} from "../../ui/empty-state"

export interface TableEmptyStateProps {
    /** Message to display (default: "No data found") */
    message?: string
    /** Additional CSS class names */
    className?: string
    /** Use simple image variant (default: true) */
    simple?: boolean
}

export function TableEmptyState({
    message = "No data found",
    className,
    simple = true,
}: TableEmptyStateProps) {
    return (
        <div className={cn(flexLayouts.rowCenter, justifyClasses.center, "h-full", className)}>
            <EmptyState image={simple ? "simple" : "default"} description={message} />
        </div>
    )
}

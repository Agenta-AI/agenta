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

import {Empty} from "antd"

import {cn, flexLayouts, justifyClasses} from "../../../utils/styles"

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
            <Empty
                image={simple ? Empty.PRESENTED_IMAGE_SIMPLE : Empty.PRESENTED_IMAGE_DEFAULT}
                description={message}
            />
        </div>
    )
}

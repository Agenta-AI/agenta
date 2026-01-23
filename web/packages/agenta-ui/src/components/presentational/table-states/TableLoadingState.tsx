/**
 * TableLoadingState Component
 *
 * A reusable loading state component for tables.
 * Displays a skeleton placeholder while data is being fetched.
 *
 * @example
 * ```typescript
 * import { TableLoadingState } from '@agenta/ui'
 *
 * if (isLoading && rows.length === 0) {
 *   return <TableLoadingState rows={8} />
 * }
 * ```
 */

import {Skeleton} from "antd"

import {cn} from "../../../utils/styles"

export interface TableLoadingStateProps {
    /** Number of skeleton rows to display (default: 8) */
    rows?: number
    /** Additional CSS class names */
    className?: string
}

export function TableLoadingState({rows = 8, className}: TableLoadingStateProps) {
    return (
        <div className={cn("space-y-2", className)}>
            <Skeleton active paragraph={{rows}} />
        </div>
    )
}

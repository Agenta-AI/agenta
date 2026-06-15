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

import type {ReactNode} from "react"

import {Empty, Typography} from "antd"

import {cn, flexLayouts, justifyClasses} from "../../../utils/styles"

const {Text} = Typography

export interface TableEmptyStateProps {
    /** Message to display (default: "No data found") */
    message?: string
    /** Secondary explanatory line shown under the message (e.g. what this list is). */
    description?: ReactNode
    /** Primary action shown below the text (e.g. a "New …" CTA button). */
    action?: ReactNode
    /** Additional CSS class names */
    className?: string
    /** Use simple image variant (default: true) */
    simple?: boolean
}

export function TableEmptyState({
    message = "No data found",
    description,
    action,
    className,
    simple = true,
}: TableEmptyStateProps) {
    return (
        <div className={cn(flexLayouts.rowCenter, justifyClasses.center, "h-full", className)}>
            <Empty
                image={simple ? Empty.PRESENTED_IMAGE_SIMPLE : Empty.PRESENTED_IMAGE_DEFAULT}
                description={
                    description ? (
                        <div className="flex flex-col items-center gap-1">
                            <Text className="text-xs font-medium">{message}</Text>
                            <Text type="secondary" className="text-xs max-w-[320px]">
                                {description}
                            </Text>
                        </div>
                    ) : (
                        message
                    )
                }
            >
                {action}
            </Empty>
        </div>
    )
}

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

import {useT} from "@agenta/i18n"
import listControlsCatalog from "@agenta/i18n/catalogs/ui.listControls"

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
    message: messageProp,
    className,
    simple = true,
}: TableEmptyStateProps) {
    const t = useT(listControlsCatalog)
    const message = messageProp ?? t("ui.listControls.noDataFound")
    return (
        <div className={cn(flexLayouts.rowCenter, justifyClasses.center, "h-full", className)}>
            <EmptyState image={simple ? "simple" : "default"} description={message} />
        </div>
    )
}

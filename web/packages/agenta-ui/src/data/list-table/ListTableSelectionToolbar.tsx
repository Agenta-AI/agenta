import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"

import {cn} from "../../foundation/utils/cn"
import {Button} from "../../primitives/button"

/**
 * The page toolbar while rows are selected: "N selected", Select all, the caller's bulk actions
 * and Clear. Drawn in place of `PageToolbar`, at its height, so selecting moves nothing.
 */
export const ListTableSelectionToolbar = ({
    count,
    onSelectAll,
    allSelected = false,
    onClear,
    actions,
    className,
}: {
    count: number
    /** Absent ⇒ no Select all. */
    onSelectAll?: () => void
    /** Every row is already selected: Select all is disabled. */
    allSelected?: boolean
    onClear: () => void
    actions?: ReactNode
    className?: string
}) => {
    const t = useT(uiControlsCatalog, commonCatalog)
    return (
        <div
            role="toolbar"
            aria-label={t("ui.controls.selectedCount", {count})}
            className={cn(
                "mb-3 flex min-h-control flex-wrap items-center gap-2 max-sm:min-h-11.5",
                className,
            )}
        >
            <span role="status" className="shrink-0 text-body font-medium text-foreground">
                {t("ui.controls.selectedCount", {count})}
            </span>
            {onSelectAll ? (
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={allSelected}
                    onClick={onSelectAll}
                >
                    {t("ui.controls.selectAll")}
                </Button>
            ) : null}
            {actions}
            <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
                {t("common.clear")}
            </Button>
        </div>
    )
}

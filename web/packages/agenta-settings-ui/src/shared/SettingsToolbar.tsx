import type {ReactNode} from "react"

import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowClockwise} from "@phosphor-icons/react"

export interface SettingsToolbarProps {
    /** The list's search. Omit it for a list short enough to read whole. */
    search?: {value: string; onChange: (next: string) => void; placeholder: string}
    /** This list's own filters, left of the right group. */
    filters?: ReactNode
    /** Reload control; it renders first in the right group, so refresh sits in one place. */
    onReload?: () => void
    reloading?: boolean
    reloadLabel?: string
    /** The list's own buttons, at the far right. */
    actions?: ReactNode
}

/**
 * The row above a Settings list: search on the list's left edge, reload and the primary button
 * on the right. The same toolbar the Agents list uses, so every list narrows the same way.
 */
export const SettingsToolbar = ({
    search,
    filters,
    onReload,
    reloading = false,
    reloadLabel = "Reload",
    actions,
}: SettingsToolbarProps) => {
    const right =
        onReload || actions ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
                {onReload ? (
                    <SimpleTooltip title={reloadLabel}>
                        <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={reloadLabel}
                            disabled={reloading}
                            onClick={() => onReload()}
                        >
                            <ArrowClockwise size={14} />
                        </Button>
                    </SimpleTooltip>
                ) : null}
                {actions}
            </div>
        ) : null

    if (search) {
        return (
            <ListTableToolbar
                search={search.value}
                onSearchChange={search.onChange}
                searchPlaceholder={search.placeholder}
                actions={
                    <>
                        {filters}
                        {right}
                    </>
                }
            />
        )
    }
    return filters || right ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            {filters}
            {right}
        </div>
    ) : null
}

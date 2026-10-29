import type {ReactNode} from "react"

import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowClockwise} from "@phosphor-icons/react"

export interface SettingsToolbarProps {
    /** This list's own filters, on the left. */
    filters?: ReactNode
    onReload?: () => void
    reloading?: boolean
    reloadLabel?: string
    /** The list's own buttons, at the far right. */
    actions?: ReactNode
}

/** The row above a Settings list: filters on the left, reload and buttons on the right. */
export const SettingsToolbar = ({
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
                            size="icon"
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

    return filters || right ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            {filters}
            {right}
        </div>
    ) : null
}

import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowsOutLineHorizontal, Copy, MinusCircle} from "@phosphor-icons/react"

export interface RowActionsProps {
    canRemove: boolean
    /** True when the row has more than one repeat of its run: the details button says so. */
    hasRepeats?: boolean
    onOpenDetails: () => void
    onRemove: () => void
    onDuplicate: () => void
}

/** Details, duplicate and remove for one test case row. The last row cannot be removed. */
export const RowActions = ({
    canRemove,
    hasRepeats,
    onOpenDetails,
    onRemove,
    onDuplicate,
}: RowActionsProps) => {
    const detailsLabel = hasRepeats ? "View all repeats" : "Open details"
    return (
        <div className="flex items-center gap-1">
            <SimpleTooltip title={detailsLabel} side="top">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={detailsLabel}
                    onClick={onOpenDetails}
                >
                    <ArrowsOutLineHorizontal />
                </Button>
            </SimpleTooltip>
            <SimpleTooltip title="Duplicate" side="top">
                <Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={onDuplicate}>
                    <Copy />
                </Button>
            </SimpleTooltip>
            <SimpleTooltip title="Remove" side="top">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove"
                    disabled={!canRemove}
                    onClick={onRemove}
                >
                    <MinusCircle />
                </Button>
            </SimpleTooltip>
        </div>
    )
}

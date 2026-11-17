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

/**
 * Details, remove and duplicate for one test case row, in the old playground's order. The last row
 * cannot be removed. With a mouse they show while the pointer is over the row header (a
 * `group/row-header` ancestor); on a touch screen they always show.
 */
export const RowActions = ({
    canRemove,
    hasRepeats,
    onOpenDetails,
    onRemove,
    onDuplicate,
}: RowActionsProps) => {
    const detailsLabel = hasRepeats ? "View all repeats" : "Open details"
    return (
        <div className="flex items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row-header:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
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
            <SimpleTooltip title="Duplicate" side="top">
                <Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={onDuplicate}>
                    <Copy />
                </Button>
            </SimpleTooltip>
        </div>
    )
}

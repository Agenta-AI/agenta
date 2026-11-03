import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Copy, MinusCircle} from "@phosphor-icons/react"

export interface RowActionsProps {
    canRemove: boolean
    onRemove: () => void
    onDuplicate: () => void
}

/** Remove and duplicate for one test case row. The last row cannot be removed. */
export const RowActions = ({canRemove, onRemove, onDuplicate}: RowActionsProps) => (
    <div className="flex items-center gap-1">
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

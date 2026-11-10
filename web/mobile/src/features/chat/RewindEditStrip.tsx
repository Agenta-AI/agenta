import {Button} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"

/** Above the composer while a sent message is being edited. Nothing is removed until Send. */
export const RewindEditStrip = ({onCancel}: {onCancel: () => void}) => (
    <div
        className="border-border bg-muted mb-2 box-border flex items-center gap-2 rounded-lg border border-solid px-3 py-2"
        role="status"
    >
        <PencilSimple aria-hidden className="text-muted-foreground shrink-0" size={16} />
        <span className="min-w-0 flex-1">
            <span className="text-foreground block text-xs font-medium">Editing a message</span>
            <span className="text-muted-foreground block text-xs">
                Sending replaces it and every turn after it.
            </span>
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
        </Button>
    </div>
)

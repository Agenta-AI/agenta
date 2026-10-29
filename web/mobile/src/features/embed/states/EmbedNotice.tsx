import {Button} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

/** A refused send, a rate limit or a failed answer. The draft stays in the composer. */
export const EmbedNotice = ({text, onDismiss}: {text: string; onDismiss: () => void}) => (
    <div
        role="alert"
        className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground"
    >
        <span className="grow">{text}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
            <X />
        </Button>
    </div>
)

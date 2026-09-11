import {Button} from "@agenta/ui/ui"
import {RefreshCw} from "lucide-react"

/** A rail card whose section failed to load: one line and the way back, inside the card's own fill. */
export const AgentOverviewCardError = ({
    message,
    onRetry,
}: {
    message: string
    onRetry: () => void
}) => (
    <div className="flex items-center gap-3 py-2">
        <p className="m-0 min-w-0 flex-1 text-[13px] text-muted-foreground">{message}</p>
        <Button
            type="button"
            variant="link"
            size="sm"
            className="shrink-0 px-0 text-foreground"
            onClick={onRetry}
        >
            <RefreshCw aria-hidden />
            Retry
        </Button>
    </div>
)

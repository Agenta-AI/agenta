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
        <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 font-[inherit] text-[13px] text-foreground outline-none hover:underline"
        >
            <RefreshCw className="size-3" aria-hidden />
            Retry
        </button>
    </div>
)

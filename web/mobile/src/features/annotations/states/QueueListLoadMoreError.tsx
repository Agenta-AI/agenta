import {Button} from "@agenta/ui/ui"

/** A page after the first failed. The rows already loaded stay on screen above this row. */
export const QueueListLoadMoreError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex items-center justify-between gap-3 py-3" role="alert">
        <span className="text-sm text-muted-foreground">Could not load more annotation queues</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

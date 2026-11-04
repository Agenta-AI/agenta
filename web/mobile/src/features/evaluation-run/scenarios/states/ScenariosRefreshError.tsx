import {Button} from "@agenta/ui/ui"

/** The last read after the run finished failed: the rows may be out of date. */
export const ScenariosRefreshError = ({onRetry}: {onRetry: () => void}) => (
    <div
        role="alert"
        className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground"
    >
        <span>Could not update the latest values</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

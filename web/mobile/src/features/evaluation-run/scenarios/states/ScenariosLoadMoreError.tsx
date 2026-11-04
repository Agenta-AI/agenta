import {Button} from "@agenta/ui/ui"

/** The next page did not load: the rows already shown stay, with a way to try again. */
export const ScenariosLoadMoreError = ({onRetry}: {onRetry: () => void}) => (
    <div
        role="alert"
        className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground"
    >
        <span>Could not load more scenarios</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

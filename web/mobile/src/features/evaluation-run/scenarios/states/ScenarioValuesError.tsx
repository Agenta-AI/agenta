import {Button} from "@agenta/ui/ui"

/** The values of one scenario did not load: the row keeps its other cells and can try again. */
export const ScenarioValuesError = ({onRetry}: {onRetry: () => void}) => (
    <div role="alert" className="flex min-w-0 flex-col items-start gap-1 text-xs">
        <span className="text-muted-foreground">Could not load these values</span>
        <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
                event.stopPropagation()
                onRetry()
            }}
        >
            Try again
        </Button>
    </div>
)

import {Button} from "@agenta/ui/ui"

/** The evaluator list did not load: say so, and offer to load it again. */
export const SelectEvaluatorsError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="m-0 text-sm text-muted-foreground">Could not load the evaluators</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

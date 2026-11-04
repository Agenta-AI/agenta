import {Button} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"

/** No own annotation and no picked evaluator yet: the way to pick one. */
export const TraceAnnotateEmpty = ({onAddEvaluator}: {onAddEvaluator: () => void}) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <p className="m-0 text-sm text-muted-foreground">There are no available annotations</p>
        <Button variant="outline" size="sm" onClick={onAddEvaluator}>
            <PlusIcon size={14} />
            Add Evaluator
        </Button>
    </div>
)

import {Button} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"

/**
 * No evaluator of this kind exists in the project. With `onCreate` the first one is created here
 * and picked; else the link opens the Evaluators page in a new tab, so the draft stays (it shows
 * only while the evaluators view is on).
 */
export const EvaluatorsEmpty = ({
    evaluatorsHref,
    onCreate,
}: {
    evaluatorsHref: string | null
    onCreate?: () => void
}) => (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border px-4 py-5">
        <p className="m-0 text-sm font-medium text-foreground">No evaluators yet</p>
        <p className="m-0 text-sm text-muted-foreground">
            Evaluators help you measure and analyze your model&apos;s responses.
        </p>
        {onCreate ? (
            <Button size="sm" className="mt-2" onClick={onCreate}>
                <PlusIcon size={14} />
                Create your first evaluator
            </Button>
        ) : evaluatorsHref ? (
            <Button asChild size="sm" className="mt-2">
                <a href={evaluatorsHref} target="_blank" rel="noopener noreferrer">
                    <PlusIcon size={14} />
                    Create your first evaluator
                </a>
            </Button>
        ) : null}
    </div>
)

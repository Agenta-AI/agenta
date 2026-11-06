import {useState} from "react"

import {
    compareBlockReason,
    type CompareBlockReason,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"

import {CompareRunsList} from "./CompareRunsList"

/** The old app's reasons, shown on the disabled button. */
const BLOCK_REASONS: Record<CompareBlockReason, string> = {
    "no-input": "Comparison requires at least one input step.",
    "no-testset": "Comparison is available only for testset-based evaluations.",
    "query-input": "Comparison is not supported for query-driven evaluations.",
    "pending-status": "Comparison is only available for completed evaluation runs.",
}

/**
 * The Compare entry. A run that cannot be compared shows the button disabled, with the reason on
 * hover. Otherwise it opens the runs this one can be compared with.
 */
export const CompareRunsButton = ({
    projectId,
    run,
    runHref,
}: {
    projectId: string
    run: EvaluationRun
    runHref: (runId: string) => string
}) => {
    const [open, setOpen] = useState(false)
    const reason = compareBlockReason(run)

    if (reason) {
        return (
            <SimpleTooltip title={BLOCK_REASONS[reason]} side="bottom">
                <span className="inline-flex" tabIndex={0}>
                    <Button size="sm" disabled>
                        Compare
                    </Button>
                </span>
            </SimpleTooltip>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="sm">Compare</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(380px,calc(100vw-32px))] p-0">
                {open ? (
                    <CompareRunsList projectId={projectId} base={run} runHref={runHref} />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

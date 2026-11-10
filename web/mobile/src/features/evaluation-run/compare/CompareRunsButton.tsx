import {useState} from "react"

import {
    compareBlockReason,
    type CompareBlockReason,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"
import dynamic from "next/dynamic"

import {CompareRunsSkeleton} from "./states/CompareRunsSkeleton"

// The picker, with its search, filters and run list, loads when it first opens.
const CompareRunsPicker = dynamic(
    () => import("./CompareRunsPicker").then((module) => module.CompareRunsPicker),
    {ssr: false, loading: () => <CompareRunsSkeleton />},
)

/** The old app's reasons, shown on the disabled button. */
const BLOCK_REASONS: Record<CompareBlockReason, string> = {
    "no-input": "Comparison requires at least one input step.",
    "no-testset": "Comparison is available only for testset-based evaluations.",
    "query-input": "Comparison is not supported for query-driven evaluations.",
    "pending-status": "Comparison is only available for completed evaluation runs.",
}

/**
 * The Compare entry, "Compare (n)" while runs are compared. A run that cannot be compared shows
 * the button disabled, with the reason on hover. Otherwise it opens the picker of runs this one
 * can be compared with.
 */
export const CompareRunsButton = ({
    projectId,
    run,
    selected,
    onChange,
}: {
    projectId: string
    run: EvaluationRun
    selected: readonly string[]
    onChange: (ids: readonly string[]) => void
}) => {
    const [open, setOpen] = useState(false)
    const reason = compareBlockReason(run)

    if (reason) {
        return (
            <SimpleTooltip title={BLOCK_REASONS[reason]} side="bottom">
                <span
                    className="inline-flex"
                    tabIndex={0}
                    role="button"
                    aria-disabled="true"
                    aria-label={`Compare. ${BLOCK_REASONS[reason]}`}
                >
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
                <Button size="sm" className="shrink-0">
                    {selected.length ? `Compare (${selected.length})` : "Compare"}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(420px,calc(100vw-32px))] p-0">
                {open ? (
                    <CompareRunsPicker
                        projectId={projectId}
                        base={run}
                        selected={selected}
                        onChange={onChange}
                    />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

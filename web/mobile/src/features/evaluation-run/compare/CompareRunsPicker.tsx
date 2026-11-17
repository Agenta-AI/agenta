import {useMemo, useState} from "react"

import {
    compareStatusCounts,
    filterCompareRuns,
    MAX_COMPARISON_RUNS,
    toggleCompareRun,
    type CompareStatusFilter,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button, Input} from "@agenta/ui/ui"

import {CompareRunRow} from "./CompareRunRow"
import {CompareStatusFilters} from "./CompareStatusFilters"
import {CompareTestsetNames} from "./CompareTestsetNames"
import {CompareRunsEmpty} from "./states/CompareRunsEmpty"
import {CompareRunsNoMatch} from "./states/CompareRunsNoMatch"
import {CompareRunsSkeleton} from "./states/CompareRunsSkeleton"
import {useCompareCandidates} from "./useCompareCandidates"

/**
 * The runs that can be compared with `base`, as in the old app: the shared test set, "Selected:
 * n/4" with Clear all, a search on the name, status filters with counts, and a checkbox per run.
 * A fifth run is not added; a message says why.
 */
export const CompareRunsPicker = ({
    projectId,
    base,
    selected,
    onChange,
}: {
    projectId: string
    base: EvaluationRun
    selected: readonly string[]
    onChange: (ids: readonly string[]) => void
}) => {
    const {candidates, isPending, isError, refetch} = useCompareCandidates({projectId, base})
    const [search, setSearch] = useState("")
    const [status, setStatus] = useState<CompareStatusFilter>("all")
    const counts = useMemo(() => compareStatusCounts(candidates), [candidates])
    const shown = useMemo(
        () => filterCompareRuns(candidates, {search, status}),
        [candidates, search, status],
    )

    const toggle = (runId: string) => {
        if (!selected.includes(runId) && selected.length >= MAX_COMPARISON_RUNS) {
            message.info(`You can compare up to ${MAX_COMPARISON_RUNS} runs at a time.`)
            return
        }
        onChange(toggleCompareRun(selected, runId))
    }

    return (
        <div className="flex flex-col">
            <div className="flex flex-col gap-2 border-0 border-b border-solid border-border p-3">
                <div className="flex items-start justify-between gap-3">
                    <CompareTestsetNames runId={base.id} />
                    <span className="flex shrink-0 items-center gap-2 text-xs text-foreground">
                        {`Selected: ${selected.length}/${MAX_COMPARISON_RUNS}`}
                        {selected.length ? (
                            <Button size="xs" variant="link" onClick={() => onChange([])}>
                                Clear all
                            </Button>
                        ) : null}
                    </span>
                </div>
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search"
                    aria-label="Search evaluations"
                />
                <CompareStatusFilters value={status} counts={counts} onChange={setStatus} />
            </div>
            {isPending ? (
                <CompareRunsSkeleton />
            ) : isError ? (
                <LoadError title="Could not load evaluations" onRetry={() => void refetch()} />
            ) : candidates.length === 0 ? (
                <CompareRunsEmpty />
            ) : shown.length === 0 ? (
                <CompareRunsNoMatch />
            ) : (
                <ul className="m-0 flex max-h-[360px] list-none flex-col overflow-y-auto p-1">
                    {shown.map((run) => (
                        <li key={run.id}>
                            <CompareRunRow
                                run={run}
                                checked={selected.includes(run.id)}
                                onToggle={() => toggle(run.id)}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"

import {CompareRunRow} from "./CompareRunRow"
import {CompareRunsEmpty} from "./states/CompareRunsEmpty"
import {CompareRunsSkeleton} from "./states/CompareRunsSkeleton"
import {useCompareCandidates} from "./useCompareCandidates"

/**
 * The runs that can be compared with `base`. The compared views are not built yet, so a row opens
 * that run's own page.
 */
export const CompareRunsList = ({
    projectId,
    base,
    runHref,
}: {
    projectId: string
    base: EvaluationRun
    runHref: (runId: string) => string
}) => {
    const {candidates, isPending, isError, refetch} = useCompareCandidates({projectId, base})

    if (isPending) return <CompareRunsSkeleton />
    if (isError) {
        return <LoadError title="Could not load evaluations" onRetry={() => void refetch()} />
    }
    if (candidates.length === 0) return <CompareRunsEmpty />
    return (
        <ul className="m-0 flex max-h-[360px] list-none flex-col overflow-y-auto p-1">
            {candidates.map((run) => (
                <li key={run.id}>
                    <CompareRunRow run={run} href={runHref(run.id)} />
                </li>
            ))}
        </ul>
    )
}

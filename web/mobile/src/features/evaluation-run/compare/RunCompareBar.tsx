import {evaluationRunQueryAtomFamily} from "@agenta/entities/evaluationRun"
import {PushPin} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CompareRunsButton} from "./CompareRunsButton"

/**
 * The row under the run name: the "Evaluations:" chips (this run, pinned) and the Compare entry.
 * It shows once the run has loaded.
 */
export const RunCompareBar = ({
    workspaceId,
    projectId,
    runId,
    runName,
}: {
    workspaceId: string
    projectId: string
    runId: string
    runName: string
}) => {
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data
    if (!run) return null

    const runHref = (id: string) => `/w/${workspaceId}/p/${projectId}/evaluations/results/${id}`

    return (
        <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 text-foreground">Evaluations:</span>
                <span
                    data-testid="run-chip"
                    className="inline-flex min-w-0 items-center gap-1 rounded-md border border-solid border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                    <PushPin aria-hidden size={12} weight="fill" className="shrink-0" />
                    <span className="truncate">{runName}</span>
                </span>
            </div>
            <CompareRunsButton projectId={projectId} run={run} runHref={runHref} />
        </div>
    )
}

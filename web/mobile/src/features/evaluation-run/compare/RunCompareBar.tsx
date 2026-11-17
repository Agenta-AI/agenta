import {evaluationRunQueryAtomFamily} from "@agenta/entities/evaluationRun"
import {PushPin} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {compareChipStyle} from "./compareChipStyle"
import {CompareRunChip} from "./CompareRunChip"
import {CompareRunsButton} from "./CompareRunsButton"
import {useCompareRunIds} from "./useCompareRunIds"

/**
 * The row under the run name: the "Evaluations:" chips (this run, pinned, then each compared run
 * in its color, removable) and the Compare entry. It shows once the run has loaded.
 */
export const RunCompareBar = ({
    projectId,
    runId,
    runName,
}: {
    projectId: string
    runId: string
    runName: string
}) => {
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data
    const [compareIds, setCompareIds] = useCompareRunIds(runId)
    if (!run) return null

    return (
        <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="shrink-0 text-foreground">Evaluations:</span>
                <span
                    data-testid="run-chip"
                    className="inline-flex min-w-0 items-center gap-1 rounded-md border border-solid px-2 py-0.5 text-xs"
                    style={compareChipStyle(0)}
                >
                    <PushPin aria-hidden size={12} weight="fill" className="shrink-0" />
                    <span className="truncate">{runName}</span>
                </span>
                {compareIds.map((id, index) => (
                    <CompareRunChip
                        key={id}
                        runId={id}
                        slot={index + 1}
                        onRemove={() => setCompareIds(compareIds.filter((other) => other !== id))}
                    />
                ))}
            </div>
            <CompareRunsButton
                projectId={projectId}
                run={run}
                selected={compareIds}
                onChange={setCompareIds}
            />
        </div>
    )
}

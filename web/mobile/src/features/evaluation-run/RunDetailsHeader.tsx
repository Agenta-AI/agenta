import type {ReactNode} from "react"

import {evaluationRunQueryAtomFamily, runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {RunCompareBar} from "./compare/RunCompareBar"
import {RunActionsMenu} from "./RunActionsMenu"
import {RunDetailsTitle} from "./RunDetailsTitle"
import {RunOnlineToggle} from "./RunOnlineToggle"

/**
 * The page header: the nav button, the run name with its "⋮" menu, Stop or Resume on a live run,
 * and under them the run chips with the Compare entry.
 */
export const RunDetailsHeader = ({
    projectId,
    runId,
    nav,
}: {
    projectId: string
    runId: string
    nav?: ReactNode
}) => {
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const settled = !runQuery.data && (runQuery.isError || runQuery.isSuccess)

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-center gap-2">
                {nav}
                <div className="flex min-w-0 flex-1 items-center gap-1">
                    <RunDetailsTitle name={header?.name ?? (settled ? "Evaluation" : null)} />
                    {header ? (
                        <RunActionsMenu projectId={projectId} runId={runId} header={header} />
                    ) : null}
                </div>
                {header ? (
                    <RunOnlineToggle projectId={projectId} runId={runId} header={header} />
                ) : null}
            </div>
            {header ? (
                <RunCompareBar projectId={projectId} runId={runId} runName={header.name} />
            ) : null}
        </div>
    )
}

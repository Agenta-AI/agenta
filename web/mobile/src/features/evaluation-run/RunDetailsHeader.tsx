import type {ReactNode} from "react"

import {evaluationRunQueryAtomFamily, runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {RunDetailsTitle} from "./RunDetailsTitle"
import {RunOnlineToggle} from "./RunOnlineToggle"

/** The title row: the nav button, the run name, and Stop or Resume on a live run. */
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
        <div className="flex min-w-0 items-center gap-2">
            {nav}
            <RunDetailsTitle name={header?.name ?? (settled ? "Evaluation" : null)} />
            {header ? (
                <RunOnlineToggle projectId={projectId} runId={runId} header={header} />
            ) : null}
        </div>
    )
}

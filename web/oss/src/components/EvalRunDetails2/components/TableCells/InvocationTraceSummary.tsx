import {memo, useMemo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"

import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import {invocationTraceSummaryAtomFamily} from "../../atoms/invocationTraceSummary"

const InvocationTraceSummary = ({
    scenarioId,
    stepKey,
    runId,
}: {
    scenarioId?: string
    stepKey?: string
    runId?: string
}) => {
    const summaryAtom = useMemo(
        () => invocationTraceSummaryAtomFamily({scenarioId, stepKey, runId}),
        [scenarioId, stepKey, runId],
    )
    const summary = useAtomValue(summaryAtom)

    if (summary.state !== "ready" || !summary.traceId) return null

    return (
        <div className={clsx("scenario-table-meta flex items-center gap-1 pt-1 text-[11px]")}>
            <SharedGenerationResultUtils
                traceId={summary.traceId}
                showStatus={false}
                className="!pt-0"
            />
        </div>
    )
}

export default memo(InvocationTraceSummary)

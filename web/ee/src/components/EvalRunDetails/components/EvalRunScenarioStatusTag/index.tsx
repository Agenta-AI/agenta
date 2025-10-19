import {memo, useMemo} from "react"

import {Tag} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {scenarioStatusFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {STATUS_COLOR, STATUS_COLOR_TEXT} from "./assets"
/**
 * Component to display the status of an evaluation scenario as a Tag.
 *
 * Retrieves the optimistic scenario overrides for the given scenarioId,
 * and uses them to show transient UI-only states like "annotating" or
 * "revalidating" if the backend has not yet been updated.
 *
 * @param scenarioId The ID of the scenario to display the status for.
 * @returns A Tag component displaying the status of the scenario.
 */
interface EvalRunScenarioStatusTagProps {
    scenarioId: string
    runId: string
    className?: string
    showAsTag?: boolean
}

const EvalRunScenarioStatusTag = ({
    scenarioId,
    runId,
    className,
    showAsTag = true,
}: EvalRunScenarioStatusTagProps) => {
    /**
     * Loadable atom wrapping scenarioStatusFamily, which provides the most
     * up-to-date status for the given scenarioId. This can be either a status
     * that is being optimistically updated, or the latest status update from
     * the backend.
     *
     * @type {import("jotai/utils").Loadable<ScenarioStatusMap | null>}
     */
    const statusLoadable = useAtomValue(
        useMemo(() => loadable(scenarioStatusFamily({scenarioId, runId})), [scenarioId, runId]),
    )
    const scenarioStatus = statusLoadable.state === "hasData" ? statusLoadable.data : undefined
    const status = (scenarioStatus?.status as string) || "pending"
    const label = getStatusLabel(status)

    return showAsTag ? (
        <Tag className={className} color={STATUS_COLOR[status]}>
            {label}
        </Tag>
    ) : (
        <span className={clsx(STATUS_COLOR_TEXT[status] ?? "text-blue-500", className)}>
            {label}
        </span>
    )
}

export default memo(EvalRunScenarioStatusTag)

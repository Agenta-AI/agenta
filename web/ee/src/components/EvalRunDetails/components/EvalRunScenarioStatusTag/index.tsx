import {memo, useMemo} from "react"

import {Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {scenarioStatusFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {STATUS_COLOR} from "./assets"
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
const EvalRunScenarioStatusTag = ({
    scenarioId,
    className,
    showAsTag = true,
}: {
    scenarioId: string
    className?: string
    showAsTag?: boolean
}) => {
    /**
     * Loadable atom wrapping scenarioStatusFamily, which provides the most
     * up-to-date status for the given scenarioId. This can be either a status
     * that is being optimistically updated, or the latest status update from
     * the backend.
     *
     * @type {import("jotai/utils").Loadable<ScenarioStatusMap | null>}
     */
    const statusLoadable = useAtomValue(
        useMemo(() => loadable(scenarioStatusFamily(scenarioId)), [scenarioId]),
    )
    const scenarioStatus = statusLoadable.state === "hasData" ? statusLoadable.data : undefined
    const status = (scenarioStatus?.status as string) || "pending"
    const label = getStatusLabel(status)

    return showAsTag ? (
        <Tag className={className}>
            <Typography.Text type="secondary">
                <span className={STATUS_COLOR[status] ?? "text-blue-500"}>{label}</span>
            </Typography.Text>
        </Tag>
    ) : (
        <span className={clsx(STATUS_COLOR[status] ?? "text-blue-500", className)}>{label}</span>
    )
}

export default memo(EvalRunScenarioStatusTag)

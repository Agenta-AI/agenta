import {memo} from "react"

import {simpleQueueMolecule, type EvaluationStatus} from "@agenta/entities/simpleQueue"
import {Tag} from "antd"
import {useAtomValue} from "jotai"

const statusColorMap: Record<string, string> = {
    pending: "default",
    queued: "processing",
    running: "processing",
    success: "success",
    failure: "error",
    errors: "error",
    cancelled: "warning",
}

const statusLabelMap: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    running: "Running",
    success: "Completed",
    failure: "Failed",
    errors: "Errors",
    cancelled: "Cancelled",
}

interface QueueStatusTagProps {
    queueId: string
    fallbackStatus?: EvaluationStatus | null
    className?: string
}

const QueueStatusTag = memo(function QueueStatusTag({
    queueId,
    fallbackStatus = null,
    className,
}: QueueStatusTagProps) {
    const status = useAtomValue(simpleQueueMolecule.selectors.status(queueId))
    const statusKey = (status ?? fallbackStatus ?? "pending").toLowerCase()

    return (
        <Tag color={statusColorMap[statusKey] ?? "default"} className={className}>
            {statusLabelMap[statusKey] ?? statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
        </Tag>
    )
})

export default QueueStatusTag

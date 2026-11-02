import {memo} from "react"

import {simpleQueueMolecule, type EvaluationStatus} from "@agenta/entities/simpleQueue"
import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {queueStatusLabel, queueStatusTone} from "../state/queueLabels"

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
    const resolved = status ?? fallbackStatus

    return (
        <Tag color={queueStatusTone(resolved)} className={className}>
            {queueStatusLabel(resolved)}
        </Tag>
    )
})

export default QueueStatusTag

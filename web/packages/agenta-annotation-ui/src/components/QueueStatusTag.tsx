import {memo} from "react"

import {queueStatusLabel, queueStatusTone} from "@agenta/annotation"
import {simpleQueueMolecule, type EvaluationStatus} from "@agenta/entities/simpleQueue"
import {Tag} from "antd"
import {useAtomValue} from "jotai"

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

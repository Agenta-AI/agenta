import {memo} from "react"

import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

interface QueueProgressCellProps {
    queueId: string
}

/**
 * Cell that displays scenario review progress for a queue.
 * Shows "X out of Y" text format matching the design.
 */
const QueueProgressCell = memo(function QueueProgressCell({queueId}: QueueProgressCellProps) {
    const progress = useAtomValue(simpleQueueMolecule.selectors.scenarioProgress(queueId))

    if (progress === null) {
        return <Skeleton.Button active size="small" style={{width: 120, height: 22}} />
    }

    if (progress.total === 0) {
        return <Typography.Text type="secondary">No items</Typography.Text>
    }

    return (
        <Typography.Text>
            {progress.completed} out of {progress.total}
        </Typography.Text>
    )
})

export default QueueProgressCell

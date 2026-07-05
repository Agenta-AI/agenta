import {memo} from "react"

import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {Skeleton} from "antd"
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
        return <span className="text-muted-foreground">No items</span>
    }

    return (
        <span>
            {progress.completed} out of {progress.total}
        </span>
    )
})

export default QueueProgressCell

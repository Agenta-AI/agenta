import {queueStatusLabel, queueStatusTone} from "@agenta/annotation"
import {Badge} from "@agenta/ui/ui"

/** The queue status as a badge. The tone names match the badge variants one to one. */
export const QueueStatusBadge = ({status}: {status: string | null | undefined}) => (
    <Badge variant={queueStatusTone(status)}>{queueStatusLabel(status)}</Badge>
)

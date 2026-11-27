import {queueStatusLabel, queueStatusTone} from "@agenta/annotation"
import {Badge, statusBadgeVariant} from "@agenta/ui/ui"

/** The queue status as a badge. */
export const QueueStatusBadge = ({status}: {status: string | null | undefined}) => (
    <Badge variant={statusBadgeVariant(queueStatusTone(status))}>{queueStatusLabel(status)}</Badge>
)

/**
 * Audit Log — Table Cell Components
 *
 * Each cell subscribes to a single event via `eventByIdAtomFamily(eventId)`.
 * Rows in the paginated store are identity-only (`{id, key}`); the full event
 * payload lives in the entity session cache, so cells resolve their own data
 * and re-render independently once a page settles.
 *
 * Actor and count are read from `attributes` — the backend leaves the
 * top-level `request_type` / `status_code` / `created_by_id` fields unset, so
 * the per-event signal lives in the attributes bag (`user_id`, `count`).
 */

import type {Event} from "@agenta/entities/event"
import {eventByIdAtomFamily} from "@agenta/entities/event"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {dayjs} from "@agenta/shared/utils"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {useAtomValue} from "jotai"

import {UserReference} from "@/oss/components/References/UserReference"

const Dash = () => <span className="text-xs text-gray-400">—</span>

/** Actor user id from `attributes.user_id`, if present. */
const readActor = (event: Event): string | null => {
    const value = event.attributes?.user_id
    return typeof value === "string" && value ? value : null
}

/** Item count from `attributes.count` (read events only). */
const readCount = (event: Event): number | null => {
    const value = event.attributes?.count
    return typeof value === "number" ? value : null
}

/** Timestamp of the event, formatted to second precision. */
export const EventTimestampCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Badge variant="outline" className="font-mono text-xs whitespace-nowrap">
                        {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss")}
                    </Badge>
                }
            />
            <TooltipContent>
                {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}
            </TooltipContent>
        </Tooltip>
    )
}

/** Dotted event-type identifier (e.g. `applications.revisions.committed`). */
export const EventTypeCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    return (
        <Badge variant="outline" className="font-mono text-xs">
            {event.event_type}
        </Badge>
    )
}

/** Actor — the user who triggered the event, resolved to a name/avatar. */
export const ActorCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    // min-w-0 + truncate lets the resolved name ellipsize inside the narrow
    // User column instead of overflowing the cell.
    return <UserReference userId={readActor(event)} className="min-w-0 [&_*]:truncate" />
}

/** Count — number of items the event touched (`attributes.count`). */
export const CountCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    const count = readCount(event)
    if (count === null) return <Dash />

    return (
        <Badge variant="outline" className="font-mono text-xs tabular-nums">
            {count}
        </Badge>
    )
}

/** Event id (UUID) — the unique identifier of this audit event. */
export const EventIdCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    return (
        <TooltipWithCopyAction copyText={event.event_id || ""} title="Copy event id">
            <Badge variant="outline" className="font-mono text-xs whitespace-nowrap">
                {event.event_id}
            </Badge>
        </TooltipWithCopyAction>
    )
}

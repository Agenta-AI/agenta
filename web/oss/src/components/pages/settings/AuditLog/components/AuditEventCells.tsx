/**
 * Audit Log — Table Cell Components
 *
 * Each cell subscribes to a single event via `eventByIdAtomFamily(eventId)`.
 * Rows in the paginated store are identity-only (`{id, key}`); the full event
 * payload lives in the entity session cache, so cells resolve their own data
 * and re-render independently once a page settles.
 */

import {eventByIdAtomFamily} from "@agenta/entities/event"
import {dayjs} from "@agenta/shared/utils"
import {Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

const REQUEST_TYPE_COLORS: Record<string, string> = {
    router: "blue",
    worker: "purple",
    unknown: "default",
}

/** Timestamp of the event, formatted to second precision. */
export const EventTimestampCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <span className="text-xs text-gray-400">—</span>

    const formatted = dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss")
    return (
        <Tooltip title={dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}>
            <Typography.Text className="text-xs whitespace-nowrap">{formatted}</Typography.Text>
        </Tooltip>
    )
}

/** Dotted event-type identifier (e.g. `applications.revisions.committed`). */
export const EventTypeCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <span className="text-xs text-gray-400">—</span>

    return (
        <Tag className="m-0 font-mono text-xs" bordered>
            {event.event_type}
        </Tag>
    )
}

/** Origin of the request that emitted the event (`router` / `worker`). */
export const RequestTypeCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <span className="text-xs text-gray-400">—</span>

    return (
        <Tag className="m-0 text-xs capitalize" color={REQUEST_TYPE_COLORS[event.request_type]}>
            {event.request_type}
        </Tag>
    )
}

/** Status code/message of the event, when present. */
export const EventStatusCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <span className="text-xs text-gray-400">—</span>
    if (!event.status_code) return <span className="text-xs text-gray-400">—</span>

    return (
        <Tooltip title={event.status_message || undefined}>
            <Typography.Text className="text-xs">{event.status_code}</Typography.Text>
        </Tooltip>
    )
}

/** Request id (UUID) that correlates all events from a single request. */
export const RequestIdCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <span className="text-xs text-gray-400">—</span>

    return (
        <Tooltip title={event.request_id}>
            <Typography.Text className="text-xs font-mono truncate block max-w-[260px]">
                {event.request_id}
            </Typography.Text>
        </Tooltip>
    )
}

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
import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {dayjs} from "@agenta/shared/utils"
import {CopyButton, Tag} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

export const Dash = () => <span className="text-xs text-colorTextTertiary">—</span>

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

    // A `title` rather than a Tooltip: the row is clickable, and a hover card over
    // every timestamp in a 50-row page fights the click target for no gain.
    return (
        <Tag
            className="m-0 whitespace-nowrap font-mono text-xs"
            title={dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}
        >
            {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss")}
        </Tag>
    )
}

/** Dotted event-type identifier (e.g. `applications.revisions.committed`). */
export const EventTypeCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    return <Tag className="m-0 font-mono text-xs">{event.event_type}</Tag>
}

/** Actor — the user who triggered the event, resolved to a name/avatar. */
export const ActorCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    const actor = event ? readActor(event) : null

    // Falls back to the raw id rather than a dash: an actor who has left the workspace no
    // longer resolves to a name, and on a host that never registers a member list nothing
    // resolves at all — the id still says who.
    // The wrapper does the ellipsizing: `truncate` needs a block box, and the resolved form
    // is an inline-flex row, so it can't carry the rule itself.
    return (
        <div className="min-w-0 truncate">
            <UserAuthorLabel
                userId={actor}
                showAvatar
                showYouLabel
                fallback={actor ?? "—"}
                className="min-w-0 [&_*]:truncate"
            />
        </div>
    )
}

/** Count — number of items the event touched (`attributes.count`). */
export const CountCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    const count = readCount(event)
    if (count === null) return <Dash />

    return <Tag className="m-0 font-mono text-xs tabular-nums">{count}</Tag>
}

/** Event id (UUID) — the unique identifier of this audit event. */
export const EventIdCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    // stopPropagation: the row opens the drawer, and copying an id is not that.
    return (
        <div className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs">{event.event_id}</span>
            <CopyButton
                text={event.event_id || ""}
                buttonText={null}
                icon
                stopPropagation
                variant="ghost"
                size="icon-sm"
                aria-label="Copy event id"
            />
        </div>
    )
}

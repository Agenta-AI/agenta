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
import {UserAuthorLabel, useIsCurrentUser, useUserDisplayName} from "@agenta/entities/shared/user"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {Copy, Eye} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {eventTypeLabel} from "./eventTypeLabels"

export const Dash = () => <span className="text-xs text-muted-foreground">—</span>

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

const shortId = (id: string) => (id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)

const copyId = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
        () => message.success(`${what} copied`),
        () => message.error("Couldn't copy the ID"),
    )

/** "Oct 5, 22:35:03" this year, "Oct 5 2025, 22:35" before; the full value is the title. */
export const EventTimestampCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    const time = dayjs(event.timestamp)
    const short = time.isSame(dayjs(), "year")
        ? time.format("MMM D, HH:mm:ss")
        : time.format("MMM D YYYY, HH:mm")
    return (
        <span
            className="truncate tabular-nums text-muted-foreground"
            title={time.format("YYYY-MM-DD HH:mm:ss.SSS")}
        >
            {short}
        </span>
    )
}

/** The event as a sentence, with its dotted type under it. */
export const EventTypeCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    return (
        <div className="flex min-w-0 flex-col">
            <span className="truncate text-foreground">{eventTypeLabel(event.event_type)}</span>
            <span
                className="truncate font-mono text-[11.5px] text-muted-foreground"
                title={event.event_type}
            >
                {event.event_type}
            </span>
        </div>
    )
}

export interface ActorCellProps {
    eventId: string
    /** Host-provided names by user id, for hosts that do not register a member list. */
    names?: ReadonlyMap<string, string>
    currentUserId?: string | null
}

/** Actor — the user who triggered the event, resolved to a name; a short id when unknown. */
export const ActorCell = ({eventId, names, currentUserId}: ActorCellProps) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    const actor = event ? readActor(event) : null
    const registeredName = useUserDisplayName(actor)
    const registeredYou = useIsCurrentUser(actor)
    const hostName = actor ? names?.get(actor) : undefined

    if (!actor) return <Dash />
    if (!registeredName && !hostName) {
        return (
            <span className="truncate font-mono text-xs text-muted-foreground" title={actor}>
                {shortId(actor)}
            </span>
        )
    }

    const isYou = registeredYou || (Boolean(currentUserId) && actor === currentUserId)
    // `truncate` needs a block box; the label itself is an inline-flex row.
    return (
        <div className="flex min-w-0 items-center gap-1" title={actor}>
            <div className="min-w-0 truncate">
                <UserAuthorLabel
                    userId={actor}
                    name={hostName}
                    showAvatar
                    className="min-w-0 [&_*]:truncate"
                />
            </div>
            {isYou ? <span className="shrink-0 text-muted-foreground">(you)</span> : null}
        </div>
    )
}

/** Count — number of items the event touched (`attributes.count`). */
export const CountCell = ({eventId}: {eventId: string}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    if (!event) return <Dash />

    const count = readCount(event)
    if (count === null) return <Dash />

    return (
        <span
            className="text-right font-mono text-xs tabular-nums text-muted-foreground"
            title={`${count} ${count === 1 ? "item" : "items"}`}
        >
            {count}
        </span>
    )
}

/** The row kebab: details, plus copying the ids the table no longer shows. */
export const EventRowMenu = ({eventId, onView}: {eventId: string; onView: () => void}) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId))
    const requestId = event?.request_id ?? null

    return (
        <SettingsRowMenu
            label="Event actions"
            items={[
                {key: "view", label: "View details", icon: <Eye size={14} />, onClick: onView},
                {type: "divider"},
                {
                    key: "copy-event-id",
                    label: "Copy event ID",
                    icon: <Copy size={14} />,
                    onClick: () => copyId(event?.event_id || eventId, "Event ID"),
                },
                {
                    key: "copy-request-id",
                    label: "Copy request ID",
                    icon: <Copy size={14} />,
                    hidden: !requestId,
                    onClick: () => requestId && copyId(requestId, "Request ID"),
                },
            ]}
        />
    )
}

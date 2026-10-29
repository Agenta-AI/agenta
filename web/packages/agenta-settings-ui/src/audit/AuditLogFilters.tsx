/**
 * Audit Log — Filter Bar
 *
 * Binds the audit-log query filters to the entity filter atoms. A change to
 * any atom flows into the paginated store's meta atom and triggers a fresh
 * page-1 fetch.
 */

import {useCallback, useEffect, useState, type ReactNode} from "react"

import {
    EventType,
    type EventType as EventTypeValue,
    type EventTimestampRange,
    eventIdFilterAtom,
    eventTimestampRangeFilterAtom,
    eventTypeFilterAtom,
    requestIdFilterAtom,
    requestTypeFilterAtom,
} from "@agenta/entities/event"
import {Button, Combobox, SearchInput, type ComboboxOptionGroup} from "@agenta/ui/ui"
import {useAtom, useSetAtom} from "jotai"

import {eventTypeGroup, eventTypeGroupRank, eventTypeLabel} from "./eventTypeLabels"

const HIDDEN_EVENT_TYPE_PREFIXES = ["applications.revisions.", "evaluators.revisions."]
const HIDDEN_EVENT_TYPES = ["unknown"]

const VISIBLE_EVENT_TYPES = Object.values(EventType).filter(
    (value) =>
        !HIDDEN_EVENT_TYPES.includes(value) &&
        !HIDDEN_EVENT_TYPE_PREFIXES.some((prefix) => value.startsWith(prefix)),
)

/** The label first, the raw type under it; the trigger hides the raw line. */
const EventOptionLabel = ({eventType}: {eventType: string}) => (
    <span className="flex min-w-0 flex-col py-0.5">
        <span className="truncate">{eventTypeLabel(eventType)}</span>
        <span
            data-event-raw
            className="truncate font-mono text-[11px] font-normal text-muted-foreground"
        >
            {eventType}
        </span>
    </span>
)

const EVENT_TYPE_OPTIONS: ComboboxOptionGroup[] = [...VISIBLE_EVENT_TYPES]
    .sort(
        (a, b) =>
            eventTypeGroupRank(a) - eventTypeGroupRank(b) ||
            eventTypeGroup(a).localeCompare(eventTypeGroup(b)) ||
            eventTypeLabel(a).localeCompare(eventTypeLabel(b)),
    )
    .reduce<ComboboxOptionGroup[]>((groups, eventType) => {
        const label = eventTypeGroup(eventType)
        let group = groups.find((item) => item.label === label)
        if (!group) {
            group = {label, options: []}
            groups.push(group)
        }
        group.options.push({
            value: eventType,
            label: <EventOptionLabel eventType={eventType} />,
            searchValue: `${eventTypeLabel(eventType)} ${label} ${eventType}`,
        })
        return groups
    }, [])

/** Debounce (ms) before committing the free-text id filter. */
const ID_DEBOUNCE_MS = 400
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AuditLogFiltersProps {
    /**
     * Hands the table a refresh that first flushes the debounced id draft, so a reload
     * clicked straight after typing uses the value on screen. The control itself lives in
     * the table's toolbar, where every list keeps its reload.
     */
    registerRefresh: (refresh: () => void) => void
    /**
     * The date-range control. The desktop's picker carries its own presets and calendar; a
     * host without one simply gets the default 24-hour window.
     */
    renderDateRange?: (state: {
        value: EventTimestampRange | null
        onChange: (next: EventTimestampRange | null) => void
    }) => ReactNode
}

export const AuditLogFilters = ({registerRefresh, renderDateRange}: AuditLogFiltersProps) => {
    const [timestampRange, setTimestampRange] = useAtom(eventTimestampRangeFilterAtom)
    const [eventType, setEventType] = useAtom(eventTypeFilterAtom)
    const [eventId, setEventId] = useAtom(eventIdFilterAtom)
    const setRequestType = useSetAtom(requestTypeFilterAtom)
    const setRequestId = useSetAtom(requestIdFilterAtom)

    // Local draft so typing doesn't refetch on every keystroke.
    const [eventIdDraft, setEventIdDraft] = useState(eventId ?? "")

    useEffect(() => {
        setRequestType(null)
        setRequestId(null)
    }, [setRequestId, setRequestType])

    // Commit the draft id into the filter atom. Only valid UUIDs filter;
    // anything else (including a partial entry) clears the filter.
    const commitEventId = useCallback(() => {
        const trimmed = eventIdDraft.trim()
        setEventId(trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null)
    }, [eventIdDraft, setEventId])

    useEffect(() => {
        const timer = setTimeout(commitEventId, ID_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [commitEventId])

    // Flush the debounced id before refreshing so a refresh clicked right after
    // typing uses the value on screen rather than the previously committed one.
    useEffect(() => {
        registerRefresh(commitEventId)
    }, [commitEventId, registerRefresh])

    const hasFilters = Boolean(eventType || eventIdDraft.trim())
    const clearFilters = () => {
        setEventType(null)
        setEventIdDraft("")
        setEventId(null)
    }

    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {renderDateRange?.({value: timestampRange, onChange: setTimestampRange})}
            <Combobox
                allowClear
                aria-label="Event type"
                placeholder="All events"
                emptyText="No matching events"
                // The trigger shows the label alone; the raw type is for the list.
                className="w-full sm:w-[240px] [&_[data-event-raw]]:hidden"
                contentClassName="w-[min(320px,calc(100vw-32px))]"
                value={eventType ?? undefined}
                onChange={(value) => setEventType((value as EventTypeValue | undefined) ?? null)}
                options={EVENT_TYPE_OPTIONS}
            />
            <SearchInput
                aria-label="Event ID"
                className="w-full sm:w-[260px]"
                placeholder="Filter by event ID"
                value={eventIdDraft}
                onValueChange={setEventIdDraft}
            />
            {hasFilters ? (
                <Button variant="ghost" onClick={clearFilters}>
                    Clear
                </Button>
            ) : null}
        </div>
    )
}

export default AuditLogFilters

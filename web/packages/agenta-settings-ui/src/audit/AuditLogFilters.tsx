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
import {Button, Cascader, Input, type CascaderOption} from "@agenta/ui/ui"
import {ArrowsClockwiseIcon} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

const HIDDEN_EVENT_TYPE_PREFIXES = ["applications.revisions.", "evaluators.revisions."]
const HIDDEN_EVENT_TYPES = ["unknown"]

const VISIBLE_EVENT_TYPES = Object.values(EventType).filter(
    (value) =>
        !HIDDEN_EVENT_TYPES.includes(value) &&
        !HIDDEN_EVENT_TYPE_PREFIXES.some((prefix) => value.startsWith(prefix)),
)

const EVENT_TYPE_OPTIONS = VISIBLE_EVENT_TYPES.reduce<CascaderOption[]>((options, eventType) => {
    const segments = eventType.split(".")
    let level = options

    segments.forEach((segment, index) => {
        const value = segments.slice(0, index + 1).join(".")
        let option = level.find((item) => item.value === value)

        if (!option) {
            option = {label: segment, value}
            level.push(option)
        }

        if (index < segments.length - 1) {
            option.children ??= []
            level = option.children
        }
    })

    return options
}, [])

const eventTypeToCascaderValue = (eventType: EventTypeValue | null): string[] | undefined => {
    if (!eventType) return undefined
    const segments = eventType.split(".")
    return segments.map((_, index) => segments.slice(0, index + 1).join("."))
}

const renderEventTypePath = (labels: string[]) => (
    <span className="font-mono">{labels.join(".")}</span>
)

/** Debounce (ms) before committing the free-text id filter. */
const ID_DEBOUNCE_MS = 400
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AuditLogFiltersProps {
    onRefresh: () => void
    /**
     * The date-range control. The desktop's picker carries its own presets and calendar; a
     * host without one simply gets the default 24-hour window.
     */
    renderDateRange?: (state: {
        value: EventTimestampRange | null
        onChange: (next: EventTimestampRange | null) => void
    }) => ReactNode
}

export const AuditLogFilters = ({onRefresh, renderDateRange}: AuditLogFiltersProps) => {
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
    const handleRefresh = useCallback(() => {
        commitEventId()
        onRefresh()
    }, [commitEventId, onRefresh])

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                variant="outline"
                size="icon"
                aria-label="Refresh audit log data"
                title="Refresh data"
                onClick={handleRefresh}
            >
                <ArrowsClockwiseIcon size={14} />
            </Button>
            {renderDateRange?.({value: timestampRange, onChange: setTimestampRange})}
            <Cascader
                allowClear
                showSearch
                aria-label="Event type"
                // `[data-slot=cascader-value]` is the @agenta/ui trigger's selected-value node —
                // the replacement for antd's `.ant-select-selection-item`.
                className="w-[280px] [&_[data-slot=cascader-value]]:font-mono"
                displayRender={renderEventTypePath}
                placeholder="Event"
                value={eventTypeToCascaderValue(eventType)}
                onChange={(value) => {
                    const selected = value?.[value.length - 1]
                    setEventType((selected as EventTypeValue | undefined) ?? null)
                }}
                options={EVENT_TYPE_OPTIONS}
            />
            <Input
                className="w-[290px] font-mono"
                placeholder="ID"
                value={eventIdDraft}
                onChange={(event) => setEventIdDraft(event.target.value)}
            />
        </div>
    )
}

export default AuditLogFilters

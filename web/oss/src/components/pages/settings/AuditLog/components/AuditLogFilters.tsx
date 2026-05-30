/**
 * Audit Log — Filter Bar
 *
 * Binds the audit-log query filters to the entity filter atoms. A change to
 * any atom flows into the paginated store's meta atom and triggers a fresh
 * page-1 fetch.
 */

import {useCallback, useEffect, useState} from "react"

import {
    EventType,
    type EventType as EventTypeValue,
    eventIdFilterAtom,
    eventTimestampRangeFilterAtom,
    eventTypeFilterAtom,
    requestIdFilterAtom,
    requestTypeFilterAtom,
} from "@agenta/entities/event"
import {ArrowsClockwiseIcon} from "@phosphor-icons/react"
import {Cascader, Input} from "antd"
import {useAtom, useSetAtom} from "jotai"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import QuickDateRangePicker from "@/oss/components/EvaluationRunsTablePOC/components/filters/QuickDateRangePicker"

const HIDDEN_EVENT_TYPE_PREFIXES = ["applications.revisions.", "evaluators.revisions."]
const HIDDEN_EVENT_TYPES = ["unknown"]

interface EventTypeOption {
    label: string
    value: string
    children?: EventTypeOption[]
}

const VISIBLE_EVENT_TYPES = Object.values(EventType).filter(
    (value) =>
        !HIDDEN_EVENT_TYPES.includes(value) &&
        !HIDDEN_EVENT_TYPE_PREFIXES.some((prefix) => value.startsWith(prefix)),
)

const EVENT_TYPE_OPTIONS = VISIBLE_EVENT_TYPES.reduce<EventTypeOption[]>((options, eventType) => {
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

interface AuditLogFiltersProps {
    onRefresh: () => void
}

const AuditLogFilters = ({onRefresh}: AuditLogFiltersProps) => {
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
            <EnhancedButton
                aria-label="Refresh audit log data"
                icon={<ArrowsClockwiseIcon size={14} className="mt-[0.8px]" />}
                onClick={handleRefresh}
                tooltipProps={{title: "Refresh data"}}
            />
            <QuickDateRangePicker value={timestampRange} onChange={setTimestampRange} />
            <Cascader
                allowClear
                showSearch
                className="w-[280px] [&_.ant-select-selection-item]:font-mono"
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
                allowClear
                className="w-[290px] font-mono"
                placeholder="ID"
                value={eventIdDraft}
                onChange={(event) => setEventIdDraft(event.target.value)}
            />
        </div>
    )
}

export default AuditLogFilters

/**
 * Audit Log — Filter Bar
 *
 * Binds the three `EventQuery` filters (event type / request type / request id)
 * to the entity filter atoms. A change to any atom flows into the paginated
 * store's meta atom and triggers a fresh page-1 fetch.
 */

import {useEffect, useState} from "react"

import {
    EventType,
    RequestType,
    eventTypeFilterAtom,
    requestIdFilterAtom,
    requestTypeFilterAtom,
} from "@agenta/entities/event"
import {Input, Select} from "antd"
import {useAtom} from "jotai"

const EVENT_TYPE_OPTIONS = Object.values(EventType).map((value) => ({label: value, value}))
const REQUEST_TYPE_OPTIONS = Object.values(RequestType).map((value) => ({
    label: value,
    value,
}))

/** Debounce (ms) before committing the free-text request-id filter. */
const REQUEST_ID_DEBOUNCE_MS = 400

const AuditLogFilters = () => {
    const [eventType, setEventType] = useAtom(eventTypeFilterAtom)
    const [requestType, setRequestType] = useAtom(requestTypeFilterAtom)
    const [requestId, setRequestId] = useAtom(requestIdFilterAtom)

    // Local draft so typing doesn't refetch on every keystroke.
    const [requestIdDraft, setRequestIdDraft] = useState(requestId ?? "")

    useEffect(() => {
        const timer = setTimeout(() => {
            setRequestId(requestIdDraft.trim() || null)
        }, REQUEST_ID_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [requestIdDraft, setRequestId])

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Select<EventType>
                allowClear
                showSearch
                size="small"
                className="w-[280px]"
                placeholder="Event type"
                value={eventType}
                onChange={(value) => setEventType(value ?? null)}
                options={EVENT_TYPE_OPTIONS}
            />
            <Select<RequestType>
                allowClear
                size="small"
                className="w-[150px]"
                placeholder="Request type"
                value={requestType}
                onChange={(value) => setRequestType(value ?? null)}
                options={REQUEST_TYPE_OPTIONS}
            />
            <Input
                allowClear
                size="small"
                className="w-[280px]"
                placeholder="Request ID"
                value={requestIdDraft}
                onChange={(event) => setRequestIdDraft(event.target.value)}
            />
        </div>
    )
}

export default AuditLogFilters

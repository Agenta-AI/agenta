/**
 * Audit Log — Table
 *
 * Renders the `event` entity's paginated store in `DataTable`. Rows are
 * identity-only; cells resolve their own event data from the entity session
 * cache. Clicking a row opens the detail drawer.
 *
 * Pages are pulled explicitly ("Load more") rather than on scroll: `DataTable`
 * is the antd-free, fully-materialized table, so the page — not a virtual
 * viewport — owns the scroll.
 */

import {useCallback, useMemo, useRef, type ReactNode} from "react"

import {
    clearEventsCacheAtom,
    eventsPaginatedStore,
    eventTimestampRangeFilterAtom,
    type EventTableRow,
} from "@agenta/entities/event"
import {dayjs} from "@agenta/shared/utils"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {Eye} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    ActorCell,
    CountCell,
    EventIdCell,
    EventTimestampCell,
    EventTypeCell,
} from "./AuditEventCells"
import AuditLogFilters, {type AuditLogFiltersProps} from "./AuditLogFilters"
import {AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_SCOPE_ID} from "./constants"

// Mirror the relative presets offered by the host's date-range picker, so Refresh can
// roll every relative window forward instead of falling back to the originally captured
// one. Uses dayjs units so `month` matches the picker's calendar math.
const RELATIVE_TIME_PRESETS: Record<
    string,
    {amount: number; unit: "minute" | "hour" | "day" | "month"}
> = {
    "30 mins": {amount: 30, unit: "minute"},
    "1 hour": {amount: 1, unit: "hour"},
    "6 hours": {amount: 6, unit: "hour"},
    "24 hours": {amount: 24, unit: "hour"},
    "3 days": {amount: 3, unit: "day"},
    "7 days": {amount: 7, unit: "day"},
    "14 days": {amount: 14, unit: "day"},
    "1 month": {amount: 1, unit: "month"},
    "3 months": {amount: 3, unit: "month"},
}

const recomputeRelativeTimestampRange = (preset?: string | null) => {
    if (!preset || preset === "custom" || preset === "all time") return null

    const config = RELATIVE_TIME_PRESETS[preset]
    if (!config) return null

    const from = dayjs().subtract(config.amount, config.unit)

    // Open-ended upper bound (no `to`) so the window always extends to "now" —
    // consistent with the default range; only the relative `from` is recomputed.
    return {from: from.toISOString(), to: null, preset}
}

export interface AuditLogTableProps {
    onSelectEvent: (eventId: string) => void
    renderDateRange?: AuditLogFiltersProps["renderDateRange"]
}

export const AuditLogTable = ({onSelectEvent, renderDateRange}: AuditLogTableProps) => {
    const refreshEvents = useSetAtom(eventsPaginatedStore.actions.refresh)
    const clearEventsCache = useSetAtom(clearEventsCacheAtom)
    const timestampRange = useAtomValue(eventTimestampRangeFilterAtom)
    const setTimestampRange = useSetAtom(eventTimestampRangeFilterAtom)

    const {rows, loadNextPage, resetPages, paginationInfo} =
        eventsPaginatedStore.store.hooks.usePagination({
            scopeId: AUDIT_LOG_SCOPE_ID,
            pageSize: AUDIT_LOG_PAGE_SIZE,
        })

    // Skeleton rows are the not-yet-settled tail of the page in flight; DataTable
    // draws its own loading state, so only settled rows reach it.
    const loadedRows = useMemo(() => rows.filter((row) => !row.__isSkeleton), [rows])

    const refreshTable = useCallback(() => {
        const refreshedRange = recomputeRelativeTimestampRange(timestampRange?.preset)
        clearEventsCache()
        resetPages()
        if (refreshedRange) {
            setTimestampRange(refreshedRange)
            return
        }
        refreshEvents()
    }, [clearEventsCache, refreshEvents, resetPages, setTimestampRange, timestampRange?.preset])

    const columns = useMemo<DataTableColumn<EventTableRow>[]>(
        () => [
            // Width strategy: columns whose content has a known footprint (Timestamp,
            // Count, ID) carry a fixed width; Event and User are left flexible and
            // absorb the remaining width.
            {
                key: "timestamp",
                title: "Timestamp",
                width: 190,
                render: (record) => <EventTimestampCell eventId={record.id} />,
            },
            {
                // Count maxes out at 9999 — narrow. No header label; the number reads
                // alongside the Event column.
                key: "count",
                title: "",
                width: 70,
                align: "right",
                render: (record) => <CountCell eventId={record.id} />,
            },
            {
                key: "event_type",
                title: "Event",
                render: (record) => <EventTypeCell eventId={record.id} />,
            },
            {
                key: "actor",
                title: "User",
                width: 180,
                render: (record) => <ActorCell eventId={record.id} />,
            },
            {
                key: "id",
                title: "ID",
                width: 330,
                render: (record) => <EventIdCell eventId={record.id} />,
            },
        ],
        [],
    )

    // The filter bar commits its debounced id draft before a reload reads it.
    const flushFiltersRef = useRef<() => void>(() => undefined)
    const handleReload = useCallback(() => {
        flushFiltersRef.current()
        refreshTable()
    }, [refreshTable])

    const filters: ReactNode = (
        <AuditLogFilters
            registerRefresh={useCallback((flush: () => void) => {
                flushFiltersRef.current = flush
            }, [])}
            renderDateRange={renderDateRange}
        />
    )

    return (
        <div className="flex flex-col gap-2">
            <DataTable<EventTableRow>
                columns={columns}
                rows={loadedRows}
                rowKey={(record) => record.key}
                loading={paginationInfo.isFetching}
                onRowClick={(record) => onSelectEvent(record.id)}
                actions={(record) => [
                    {
                        key: "view",
                        label: "View details",
                        icon: <Eye size={16} />,
                        onClick: () => onSelectEvent(record.id),
                    },
                ]}
                filters={filters}
                onReload={handleReload}
                reloading={paginationInfo.isFetching}
                reloadLabel="Reload audit log"
                empty={
                    <EmptyState
                        image="simple"
                        description="No events in this window. Widen the date range or clear the filters."
                    />
                }
            />

            {paginationInfo.hasMore ? (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        onClick={loadNextPage}
                        disabled={paginationInfo.isFetching}
                    >
                        {paginationInfo.isFetching ? "Loading…" : "Load more"}
                    </Button>
                </div>
            ) : null}
        </div>
    )
}

export default AuditLogTable

/**
 * Audit Log — Table
 *
 * Renders the `event` entity's paginated store in `ListTable`. Rows are
 * identity-only; cells resolve their own event data from the entity session
 * cache. Clicking a row opens the detail drawer.
 *
 * Pages are pulled explicitly ("Load more") rather than on scroll: `ListTable`
 * is fully materialized, so the page — not a virtual viewport — owns the scroll.
 */

import {useCallback, useMemo, useRef, type ReactNode} from "react"

import {
    clearEventsCacheAtom,
    eventsPaginatedStore,
    eventTimestampRangeFilterAtom,
    type EventTableRow,
} from "@agenta/entities/event"
import {dayjs} from "@agenta/shared/utils"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ClockCounterClockwise, Eye} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {SettingsToolbar} from "../shared/SettingsToolbar"

import {
    ActorCell,
    CountCell,
    EventIdCell,
    EventTimestampCell,
    EventTypeCell,
} from "./AuditEventCells"
import AuditLogFilters, {type AuditLogFiltersProps} from "./AuditLogFilters"
import {AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_SCOPE_ID} from "./constants"

// The count has no heading of its own: the number reads alongside the Event column.
const COLUMNS: ListTableColumn[] = [
    {key: "event_type", label: "Event", width: "minmax(240px,2fr)"},
    {
        key: "count",
        label: "Count",
        srOnly: true,
        width: "56px",
        headerClassName: "text-right",
    },
    {key: "timestamp", label: "Timestamp", width: "minmax(160px,1.2fr)"},
    {key: "actor", label: "User", width: "minmax(140px,1fr)"},
    {key: "id", label: "ID", width: "minmax(240px,2fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

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

    // Skeleton rows are the not-yet-settled tail of the page in flight; ListTable
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
        <div className="flex flex-col">
            <SettingsToolbar
                filters={filters}
                onReload={handleReload}
                reloading={paginationInfo.isFetching}
                reloadLabel="Reload audit log"
            />
            <ListTable<EventTableRow>
                columns={COLUMNS}
                groups={[{key: "all", label: null, rows: loadedRows}]}
                rowKey={(record) => record.key}
                minWidth={920}
                loading={paginationInfo.isFetching && loadedRows.length === 0}
                hideHeader={!paginationInfo.isFetching && loadedRows.length === 0}
                onOpenRow={(record) => onSelectEvent(record.id)}
                empty={
                    <SettingsEmpty
                        icon={<ClockCounterClockwise size={18} />}
                        title="No events in this window"
                        description="Widen the date range or clear the filters."
                    />
                }
                renderRow={(record) => (
                    <>
                        <EventTypeCell eventId={record.id} />
                        <CountCell eventId={record.id} />
                        <EventTimestampCell eventId={record.id} />
                        <ActorCell eventId={record.id} />
                        <EventIdCell eventId={record.id} />
                        <SettingsRowMenu
                            label="Event actions"
                            items={[
                                {
                                    key: "view",
                                    label: "View details",
                                    icon: <Eye size={14} />,
                                    onClick: () => onSelectEvent(record.id),
                                },
                            ]}
                        />
                    </>
                )}
            />

            {paginationInfo.hasMore ? (
                <div className="mt-3 flex justify-center">
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

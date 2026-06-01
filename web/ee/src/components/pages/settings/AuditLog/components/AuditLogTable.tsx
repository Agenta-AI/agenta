/**
 * Audit Log — Table
 *
 * Renders the `event` entity's paginated store in the InfiniteVirtualTable
 * shell. Rows are identity-only; cells resolve their own event data from the
 * entity session cache. Clicking a row opens the detail drawer.
 */

import {type CSSProperties, useCallback, useMemo, useRef} from "react"

import {
    clearEventsCacheAtom,
    eventsPaginatedStore,
    eventTimestampRangeFilterAtom,
    type EventTableRow,
} from "@agenta/entities/event"
import {dayjs} from "@agenta/shared/utils"
import {
    createActionsColumn,
    InfiniteVirtualTableFeatureShell,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Eye} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_ROW_HEIGHT, AUDIT_LOG_SCOPE_ID} from "../assets/constants"
import {auditDrawerOpenAtom, selectedEventIdAtom} from "../state"

import {
    ActorCell,
    CountCell,
    EventIdCell,
    EventTimestampCell,
    EventTypeCell,
} from "./AuditEventCells"
import AuditLogFilters from "./AuditLogFilters"

const SkeletonCell = () => <Skeleton.Input active size="small" className="w-full" />

// Mirror the relative presets offered by QuickDateRangePicker. Keep this in
// sync with SORT_PRESETS there — including the `month` presets — so Refresh can
// roll every relative window forward instead of falling back to the originally
// captured one. Uses dayjs units so `month` matches the picker's calendar math.
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

const AuditLogTable = () => {
    const setSelectedEventId = useSetAtom(selectedEventIdAtom)
    const setDrawerOpen = useSetAtom(auditDrawerOpenAtom)
    const refreshEvents = useSetAtom(eventsPaginatedStore.actions.refresh)
    const clearEventsCache = useSetAtom(clearEventsCacheAtom)
    const timestampRange = useAtomValue(eventTimestampRangeFilterAtom)
    const setTimestampRange = useSetAtom(eventTimestampRangeFilterAtom)
    const resetPagesRef = useRef<(() => void) | null>(null)
    const globalStore = useMemo(() => getDefaultStore(), [])

    const openEvent = useCallback(
        (eventId: string) => {
            setSelectedEventId(eventId)
            setDrawerOpen(true)
        },
        [setSelectedEventId, setDrawerOpen],
    )

    const refreshTable = useCallback(() => {
        const refreshedRange = recomputeRelativeTimestampRange(timestampRange?.preset)
        clearEventsCache()
        resetPagesRef.current?.()
        if (refreshedRange) {
            setTimestampRange(refreshedRange)
            return
        }
        refreshEvents()
    }, [clearEventsCache, refreshEvents, setTimestampRange, timestampRange?.preset])

    const columns = useMemo<ColumnsType<EventTableRow>>(
        () => [
            // Width strategy: columns whose content has a known, fixed footprint
            // (Timestamp, Count, ID) are pinned via `maxWidth` so the smart-resize
            // hook treats them as constrained and never stretches them. Event and
            // User have variable-length content, so they're left flexible (no
            // `maxWidth`) and absorb the remaining viewport width.
            //
            // Every column still carries `width` + matching `minWidth` + an
            // `onHeaderCell` min-width so the sticky header <th> can't collapse
            // narrower than the virtual body cell (that mismatch is what makes the
            // header/body dividers drift apart left-to-right).
            {
                key: "timestamp",
                dataIndex: "timestamp",
                // Fixed-format "YYYY-MM-DD HH:mm:ss" chip — known width, pinned.
                title: "Timestamp",
                width: 190,
                minWidth: 190,
                maxWidth: 190,
                onHeaderCell: () => ({style: {minWidth: 190}}),
                render: (_value, record) =>
                    record.__isSkeleton ? (
                        <SkeletonCell />
                    ) : (
                        <EventTimestampCell eventId={record.id} />
                    ),
            },
            {
                key: "count",
                dataIndex: "count",
                // Count maxes out at 9999 (4 digits) — narrow fixed column, pinned.
                // No header label; the number reads alongside the Event column.
                title: "",
                width: 70,
                minWidth: 70,
                maxWidth: 70,
                align: "right",
                onHeaderCell: () => ({style: {minWidth: 70}}),
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <CountCell eventId={record.id} />,
            },
            {
                key: "event_type",
                dataIndex: "event_type",
                // Variable-length dotted identifier — flexible (no maxWidth).
                title: "Event",
                width: 300,
                minWidth: 300,
                onHeaderCell: () => ({style: {minWidth: 300}}),
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <EventTypeCell eventId={record.id} />,
            },
            {
                key: "actor",
                dataIndex: "actor",
                // Variable-length user name — flexible, with ellipsis on overflow.
                title: "User",
                width: 160,
                minWidth: 160,
                ellipsis: true,
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <ActorCell eventId={record.id} />,
            },
            {
                key: "id",
                dataIndex: "id",
                // Full 36-char UUID chip — known width, pinned.
                title: "ID",
                width: 320,
                minWidth: 320,
                maxWidth: 320,
                onHeaderCell: () => ({style: {minWidth: 320}}),
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <EventIdCell eventId={record.id} />,
            },
            // Actions column — hosts the column-visibility menu in its header
            // (via createActionsColumn) plus a per-row menu. `maxWidth` matches
            // the working tables: it marks the column as width-constrained so the
            // smart-resize hook treats it as fixed rather than flexible.
            createActionsColumn<EventTableRow>({
                type: "actions",
                width: 56,
                maxWidth: 56,
                items: [
                    {
                        key: "view",
                        label: "View details",
                        icon: <Eye size={16} />,
                        onClick: (record) => openEvent(record.id),
                    },
                ],
                showCopyId: true,
                getRecordId: (record) => record.id,
            }),
        ],
        [openEvent],
    )

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: AUDIT_LOG_SCOPE_ID,
            pageSize: AUDIT_LOG_PAGE_SIZE,
            enableInfiniteScroll: true,
            // Enables the column-visibility menu (persisted) surfaced from the
            // actions column header.
            columnVisibilityStorageKey: "audit-log:columns",
        }),
        [],
    )

    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            // Match the shared useTableManager defaults. `tableLayout: "fixed"` is
            // what every working table uses; it forces antd to size both the
            // sticky header and the virtual body strictly from the computed
            // <colgroup> widths instead of letting the body fall back to
            // content-based `auto` layout (the source of the header/body drift).
            sticky: true,
            tableLayout: "fixed" as const,
            bordered: true,
            onRow: (record: EventTableRow) => ({
                onClick: () => {
                    if (record.__isSkeleton || !record.id) return
                    openEvent(record.id)
                },
                className: "cursor-pointer",
                // Pin every row to a fixed height. The virtual list is fastest
                // when row heights are known up front — otherwise it measures
                // each row on render. The package shell only uses rowHeight to
                // estimate body height, not to size the rows, so we set it here
                // (mirrors what useTableManager does on the oss tables).
                style: {
                    height: AUDIT_LOG_ROW_HEIGHT,
                    minHeight: AUDIT_LOG_ROW_HEIGHT,
                } as CSSProperties,
            }),
        }),
        [openEvent],
    )

    const filters = useMemo(() => <AuditLogFilters onRefresh={refreshTable} />, [refreshTable])

    return (
        <InfiniteVirtualTableFeatureShell<EventTableRow>
            datasetStore={eventsPaginatedStore.store as never}
            tableScope={tableScope}
            columns={columns}
            rowKey="key"
            filters={filters}
            onPaginationStateChange={({resetPages}) => {
                resetPagesRef.current = resetPages
            }}
            enableExport={false}
            autoHeight
            rowHeight={AUDIT_LOG_ROW_HEIGHT}
            fallbackControlsHeight={56}
            fallbackHeaderHeight={48}
            tableProps={tableProps}
            store={globalStore}
            className="flex-1 min-h-0"
            // Vertically center single-line cell content (with a fixed row height
            // the antd virtual cell otherwise top-aligns).
            tableClassName="[&_.ant-table-cell]:!align-middle"
        />
    )
}

export default AuditLogTable

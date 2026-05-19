/**
 * Audit Log — Table
 *
 * Renders the `event` entity's paginated store in the InfiniteVirtualTable
 * shell. Rows are identity-only; cells resolve their own event data from the
 * entity session cache. Clicking a row opens the detail drawer.
 */

import {useCallback, useMemo} from "react"

import {eventsPaginatedStore, type EventTableRow} from "@agenta/entities/event"
import {Skeleton} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {
    InfiniteVirtualTableFeatureShell,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"

import {AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_ROW_HEIGHT, AUDIT_LOG_SCOPE_ID} from "../assets/constants"
import {auditDrawerOpenAtom, selectedEventIdAtom} from "../state"

import {
    EventStatusCell,
    EventTimestampCell,
    EventTypeCell,
    RequestIdCell,
    RequestTypeCell,
} from "./AuditEventCells"
import AuditLogFilters from "./AuditLogFilters"

const SkeletonCell = () => <Skeleton.Input active size="small" className="w-full" />

const AuditLogTable = () => {
    const setSelectedEventId = useSetAtom(selectedEventIdAtom)
    const setDrawerOpen = useSetAtom(auditDrawerOpenAtom)
    const globalStore = useMemo(() => getDefaultStore(), [])

    const openEvent = useCallback(
        (eventId: string) => {
            setSelectedEventId(eventId)
            setDrawerOpen(true)
        },
        [setSelectedEventId, setDrawerOpen],
    )

    const columns = useMemo<ColumnsType<EventTableRow>>(
        () => [
            {
                key: "timestamp",
                dataIndex: "timestamp",
                title: "Time",
                width: 190,
                render: (_value, record) =>
                    record.__isSkeleton ? (
                        <SkeletonCell />
                    ) : (
                        <EventTimestampCell eventId={record.id} />
                    ),
            },
            {
                key: "event_type",
                dataIndex: "event_type",
                title: "Event",
                width: 320,
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <EventTypeCell eventId={record.id} />,
            },
            {
                key: "request_type",
                dataIndex: "request_type",
                title: "Source",
                width: 120,
                render: (_value, record) =>
                    record.__isSkeleton ? (
                        <SkeletonCell />
                    ) : (
                        <RequestTypeCell eventId={record.id} />
                    ),
            },
            {
                key: "status",
                dataIndex: "status_code",
                title: "Status",
                width: 120,
                render: (_value, record) =>
                    record.__isSkeleton ? (
                        <SkeletonCell />
                    ) : (
                        <EventStatusCell eventId={record.id} />
                    ),
            },
            {
                key: "request_id",
                dataIndex: "request_id",
                title: "Request ID",
                render: (_value, record) =>
                    record.__isSkeleton ? <SkeletonCell /> : <RequestIdCell eventId={record.id} />,
            },
        ],
        [],
    )

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: AUDIT_LOG_SCOPE_ID,
            pageSize: AUDIT_LOG_PAGE_SIZE,
            enableInfiniteScroll: true,
        }),
        [],
    )

    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            bordered: true,
            onRow: (record: EventTableRow) => ({
                onClick: () => {
                    if (record.__isSkeleton || !record.id) return
                    openEvent(record.id)
                },
                className: "cursor-pointer",
            }),
        }),
        [openEvent],
    )

    const filters = useMemo(() => <AuditLogFilters />, [])

    return (
        <InfiniteVirtualTableFeatureShell<EventTableRow>
            datasetStore={eventsPaginatedStore.store}
            tableScope={tableScope}
            columns={columns}
            rowKey="key"
            filters={filters}
            enableExport={false}
            autoHeight
            rowHeight={AUDIT_LOG_ROW_HEIGHT}
            fallbackControlsHeight={56}
            fallbackHeaderHeight={48}
            tableProps={tableProps}
            store={globalStore}
            className="flex-1 min-h-0"
        />
    )
}

export default AuditLogTable

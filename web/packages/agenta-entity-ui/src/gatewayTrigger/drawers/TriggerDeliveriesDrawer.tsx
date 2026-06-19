import {useMemo} from "react"

import {
    triggerDeliveriesDrawerAtom,
    useTriggerDeliveries,
    type TriggerDelivery,
} from "@agenta/entities/gatewayTrigger"
import {Editor} from "@agenta/ui/editor"
import {Alert, Drawer, Empty, Spin, Table, Tag, Tooltip, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"

// ---------------------------------------------------------------------------
// TriggerDeliveriesDrawer — read-only delivery history for one subscription.
//
// One audit row per inbound event dispatched to the bound workflow: status,
// event_id, result/error, timestamps. The inbound dual of webhook deliveries.
// ---------------------------------------------------------------------------

function statusColor(type?: string | null): string {
    switch ((type ?? "").toLowerCase()) {
        case "success":
        case "delivered":
        case "ok":
            return "green"
        case "error":
        case "failed":
        case "failure":
            return "red"
        case "pending":
        case "running":
            return "blue"
        default:
            return "default"
    }
}

export default function TriggerDeliveriesDrawer() {
    const [state, setState] = useAtom(triggerDeliveriesDrawerAtom)
    const open = !!state

    const {deliveries, isLoading} = useTriggerDeliveries(state?.subscriptionId)

    const columns: ColumnsType<TriggerDelivery> = useMemo(
        () => [
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({style: {minWidth: 120}}),
                render: (_, record) => {
                    const type = record.status?.type ?? record.status?.code
                    return (
                        <Tooltip title={record.status?.message ?? undefined}>
                            <Tag color={statusColor(record.status?.type)}>{type ?? "unknown"}</Tag>
                        </Tooltip>
                    )
                },
            },
            {
                title: "Event ID",
                dataIndex: "event_id",
                key: "event_id",
                onHeaderCell: () => ({style: {minWidth: 180}}),
                render: (value: string) => (
                    <Typography.Text className="text-xs" copyable={{text: value}}>
                        {value}
                    </Typography.Text>
                ),
            },
            {
                title: "Result",
                key: "result",
                onHeaderCell: () => ({style: {minWidth: 200}}),
                render: (_, record) => {
                    if (record.data?.error) {
                        return (
                            <Typography.Text type="danger" className="text-xs" ellipsis>
                                {record.data.error}
                            </Typography.Text>
                        )
                    }
                    const result = record.data?.result
                    if (!result || Object.keys(result).length === 0) {
                        return <Typography.Text type="secondary">-</Typography.Text>
                    }
                    return (
                        <Typography.Text className="text-xs" ellipsis>
                            {JSON.stringify(result)}
                        </Typography.Text>
                    )
                },
            },
            {
                title: "When",
                key: "timestamp",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => {
                    const ts = record.status?.timestamp ?? record.created_at
                    return (
                        <Typography.Text className="text-xs">
                            {ts ? new Date(ts).toLocaleString() : "-"}
                        </Typography.Text>
                    )
                },
            },
        ],
        [],
    )

    return (
        <Drawer
            open={open}
            onClose={() => setState(null)}
            title={`Deliveries${state?.subscriptionName ? ` · ${state.subscriptionName}` : ""}`}
            width={720}
            destroyOnClose
        >
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Spin />
                </div>
            ) : (
                <Table<TriggerDelivery>
                    columns={columns}
                    dataSource={deliveries}
                    rowKey={(record) => record.id ?? record.event_id}
                    bordered
                    size="small"
                    pagination={false}
                    locale={{emptyText: <Empty description="No deliveries yet" />}}
                    expandable={{
                        expandedRowRender: (record) =>
                            record.data?.error ? (
                                <Alert
                                    type="error"
                                    message="Delivery failed"
                                    description={record.data.error}
                                    showIcon
                                />
                            ) : (
                                <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
                                    <Editor
                                        initialValue={JSON.stringify(
                                            record.data?.result ?? {},
                                            null,
                                            2,
                                        )}
                                        codeOnly
                                        showToolbar={false}
                                        language="json"
                                        disabled
                                        dimensions={{width: "100%", height: 160}}
                                    />
                                </div>
                            ),
                        rowExpandable: (record) => !!record.data?.result || !!record.data?.error,
                    }}
                />
            )}
        </Drawer>
    )
}

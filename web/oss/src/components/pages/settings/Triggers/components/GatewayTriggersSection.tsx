import {useCallback, useMemo} from "react"

import {
    eventsDrawerAtom,
    useTriggerConnectionsQuery,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import {TriggerEventsDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {Lightning} from "@phosphor-icons/react"
import {Button, Empty, Table, Tag, Tooltip, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const DEFAULT_PROVIDER = "composio"

export default function GatewayTriggersSection() {
    const {connections, isLoading} = useTriggerConnectionsQuery()
    const setEventsDrawer = useSetAtom(eventsDrawerAtom)

    const openEvents = useCallback(
        (record: TriggerConnection) => {
            setEventsDrawer({
                providerKey: record.provider_key ?? DEFAULT_PROVIDER,
                integrationKey: record.integration_key,
                integrationName: record.name ?? record.slug ?? record.integration_key,
                connectionId: record.id ?? undefined,
            })
        },
        [setEventsDrawer],
    )

    const columns: ColumnsType<TriggerConnection> = useMemo(
        () => [
            {
                title: "Integration",
                key: "integration",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Tag
                        bordered={false}
                        color="default"
                        className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                    >
                        {record.integration_key}
                    </Tag>
                ),
            },
            {
                title: "Name",
                key: "name",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text>{record.name || record.slug}</Typography.Text>
                ),
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({style: {minWidth: 120}}),
                render: (_, record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm"}) : "-",
            },
            {
                title: "",
                key: "actions",
                width: 120,
                fixed: "right",
                align: "right",
                render: (_, record) => (
                    <Button
                        size="small"
                        icon={<Lightning size={14} />}
                        onClick={(e) => {
                            e.stopPropagation()
                            openEvents(record)
                        }}
                    >
                        Events
                    </Button>
                ),
            },
        ],
        [openEvents],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">
                        Trigger integrations
                    </Typography.Text>
                    <Tooltip title="Browse the events of a connected integration">
                        <Lightning size={14} />
                    </Tooltip>
                </div>

                <Typography.Text type="secondary" className="text-xs">
                    Triggers reuse the same connections as tools. Connect an integration under
                    Tools, then browse its events here.
                </Typography.Text>

                <Table<TriggerConnection>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={connections}
                    rowKey={(record) => record.id ?? record.slug ?? record.integration_key}
                    bordered
                    pagination={false}
                    loading={isLoading}
                    locale={{
                        emptyText: <Empty description="No connected integrations yet" />,
                    }}
                    onRow={(record) => ({
                        onClick: () => openEvents(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <TriggerEventsDrawer />
        </>
    )
}

import {useMemo} from "react"

import {PlugsConnected} from "@phosphor-icons/react"
import {Button, Table, Tag, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {useChannelConnectionsQuery} from "@/oss/state/channels"
import type {ChannelConnection} from "@/oss/state/channels/schemas"

import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"

/**
 * Read-only list over the channels domain's own connection rows.
 * Install is the platform's existing connection-creation flow — this
 * package never builds a second one.
 */
export default function ConnectionsSection() {
    const {connections, isLoading} = useChannelConnectionsQuery()

    const columns: ColumnsType<ChannelConnection> = useMemo(
        () => [
            {
                title: "Channel",
                key: "channel",
                render: (_, record) => (
                    <Tag bordered={false} color="default" className="bg-[var(--ag-c-0517290F)]">
                        {record.channel}
                    </Tag>
                ),
            },
            {
                title: "Slug",
                key: "slug",
                render: (_, record) => <Typography.Text code>{record.slug}</Typography.Text>,
            },
            {
                title: "Name",
                key: "name",
                render: (_, record) => (
                    <Typography.Text>{record.name || record.slug}</Typography.Text>
                ),
            },
            {
                title: "Status",
                key: "status",
                render: (_, record) =>
                    (record.flags?.is_active ?? true) ? (
                        <Tag color="green">Active</Tag>
                    ) : (
                        <Tag>Paused</Tag>
                    ),
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm"}) : "-",
            },
        ],
        [],
    )

    return (
        <section className="flex flex-col gap-3">
            <ChannelsSectionHeader
                icon={<PlugsConnected size={16} />}
                title="Connections"
                description="Installed channel apps. Connections are created from the platform's existing install flow."
                actions={
                    <Button size="small" href="/settings?tab=triggers">
                        Manage connections
                    </Button>
                }
            />
            <Table<ChannelConnection>
                className="ph-no-capture"
                columns={columns}
                dataSource={connections}
                rowKey={(record) => record.id ?? record.slug ?? record.external_key}
                bordered
                pagination={false}
                loading={isLoading}
                locale={{
                    emptyText: isLoading ? (
                        <span />
                    ) : (
                        <ChannelsEmptyState
                            icon={<PlugsConnected size={32} />}
                            title="No channel connections yet"
                            description="Install a channel app (e.g. Slack) from the connections flow to get started."
                        />
                    ),
                }}
            />
        </section>
    )
}

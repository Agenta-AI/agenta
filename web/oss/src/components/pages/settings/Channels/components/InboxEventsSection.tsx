import {useMemo, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Tray} from "@phosphor-icons/react"
import {Input, Table, Tag} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {channelInboxEventsQueryAtomFamily} from "@/oss/state/channels"

import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"

/** Read-only inbox event log (debugging surface). No create action — the
 * log is written only by the ingress route and the backfill worker. */
export default function InboxEventsSection() {
    const [spaceId, setSpaceId] = useState("")
    const query = useAtomValue(channelInboxEventsQueryAtomFamily({space_id: spaceId || undefined}))
    const events = query.data?.events ?? []

    const columns: ColumnsType<AgentaApi.ChannelInboxEvent> = useMemo(
        () => [
            {
                title: "Space",
                dataIndex: "space_id",
                key: "space_id",
                render: (v) => v ?? "unrouted",
            },
            {
                title: "Kind",
                dataIndex: "kind",
                key: "kind",
                render: (v: string) => <Tag bordered={false}>{v}</Tag>,
            },
            {
                title: "Origin",
                dataIndex: "origin",
                key: "origin",
                render: (v: string) => <Tag color={v === "pulled" ? "purple" : "blue"}>{v}</Tag>,
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm:ss"}) : "-",
            },
        ],
        [],
    )

    return (
        <section className="flex flex-col gap-3">
            <ChannelsSectionHeader
                icon={<Tray size={16} />}
                title="Inbox events"
                description="What was said in a space, in arrival order — for diagnosing a stuck or skipped message."
            />
            <Input
                placeholder="Filter by space id"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                style={{maxWidth: 260}}
            />
            <Table<AgentaApi.ChannelInboxEvent>
                className="ph-no-capture"
                columns={columns}
                dataSource={events}
                rowKey={(record) => record.id ?? ""}
                bordered
                pagination={false}
                loading={query.isPending}
                locale={{
                    emptyText: query.isPending ? (
                        <span />
                    ) : (
                        <ChannelsEmptyState
                            icon={<Tray size={32} />}
                            title="No inbox events yet"
                            description="Events appear once a message arrives in a configured space."
                        />
                    ),
                }}
            />
        </section>
    )
}

import {useMemo, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {PaperPlaneTilt} from "@phosphor-icons/react"
import {Input, Table, Tag} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {channelOutboxEventsQueryAtomFamily} from "@/oss/state/channels"

import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"

const STATE_COLOR: Record<string, string> = {
    created: "default",
    sent: "green",
    failed: "red",
    abandoned: "orange",
}

/** Read-only outbox event log (debugging surface). No create action — the
 * log is written only by the outbox worker. */
export default function OutboxEventsSection() {
    const [threadId, setThreadId] = useState("")
    const query = useAtomValue(
        channelOutboxEventsQueryAtomFamily({thread_id: threadId || undefined}),
    )
    const events = query.data?.events ?? []

    const columns: ColumnsType<AgentaApi.ChannelOutboxEvent> = useMemo(
        () => [
            {title: "Thread", dataIndex: "thread_id", key: "thread_id"},
            {title: "Turn", dataIndex: "turn_id", key: "turn_id"},
            {
                title: "State",
                dataIndex: "state",
                key: "state",
                render: (v: string) => <Tag color={STATE_COLOR[v] ?? "default"}>{v}</Tag>,
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
                icon={<PaperPlaneTilt size={16} />}
                title="Outbox events"
                description="What we owe the platform, after interpretation — for diagnosing a stuck or skipped reply."
            />
            <Input
                placeholder="Filter by thread id"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
                style={{maxWidth: 260}}
            />
            <Table<AgentaApi.ChannelOutboxEvent>
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
                            icon={<PaperPlaneTilt size={32} />}
                            title="No outbox events yet"
                            description="Events appear once an agent posts a reply."
                        />
                    ),
                }}
            />
        </section>
    )
}

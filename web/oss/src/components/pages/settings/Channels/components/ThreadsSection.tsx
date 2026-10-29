import {useMemo, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {ChatCircleDots} from "@phosphor-icons/react"
import {Button, Input, Table, Tag, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {channelThreadsQueryAtomFamily, useChannelThreadActions} from "@/oss/state/channels"

import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"

/**
 * Read-only thread browser (debugging surface, D24) plus the one write this
 * domain exposes for threads: "close" (`!new`'s web equivalent). No create
 * action anywhere here — the API exposes no create route for threads.
 */
export default function ThreadsSection() {
    const [spaceId, setSpaceId] = useState("")
    const [agentId, setAgentId] = useState("")
    const query = useAtomValue(
        channelThreadsQueryAtomFamily({
            space_id: spaceId || undefined,
            agent_id: agentId || undefined,
        }),
    )
    const {close} = useChannelThreadActions()

    const threads = query.data?.threads ?? []

    const confirmClose = (record: AgentaApi.ChannelThread) => {
        AlertPopup({
            title: "Close thread",
            message:
                "This starts a new session next time this agent is addressed here (like !new).",
            onOk: async () => {
                if (!record.id) return
                try {
                    await close(record.id)
                    message.success("Thread closed")
                } catch {
                    message.error("Failed to close thread")
                }
            },
        })
    }

    const columns: ColumnsType<AgentaApi.ChannelThread> = useMemo(
        () => [
            {title: "Space", dataIndex: "space_id", key: "space_id"},
            {title: "Agent", dataIndex: "agent_id", key: "agent_id"},
            {title: "Session", dataIndex: "session_id", key: "session_id"},
            {
                title: "Active",
                key: "is_active",
                render: (_, record) =>
                    (record.flags?.is_active ?? true) ? (
                        <Tag color="green">Active</Tag>
                    ) : (
                        <Tag>Closed</Tag>
                    ),
            },
            {
                title: "Actions",
                key: "actions",
                width: 100,
                render: (_, record) => (
                    <Button size="small" onClick={() => confirmClose(record)}>
                        Close
                    </Button>
                ),
            },
        ],
        [],
    )

    return (
        <section className="flex flex-col gap-3">
            <ChannelsSectionHeader
                icon={<ChatCircleDots size={16} />}
                title="Threads"
                description="One agent's session history in one place. Filter by space or agent."
            />
            <div className="flex gap-2">
                <Input
                    placeholder="Filter by space id"
                    value={spaceId}
                    onChange={(e) => setSpaceId(e.target.value)}
                    style={{maxWidth: 260}}
                />
                <Input
                    placeholder="Filter by agent id"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    style={{maxWidth: 260}}
                />
            </div>
            <Table<AgentaApi.ChannelThread>
                className="ph-no-capture"
                columns={columns}
                dataSource={threads}
                rowKey={(record) => record.id ?? ""}
                bordered
                pagination={false}
                loading={query.isPending}
                locale={{
                    emptyText: query.isPending ? (
                        <span />
                    ) : (
                        <ChannelsEmptyState
                            icon={<ChatCircleDots size={32} />}
                            title="No threads yet"
                            description="Threads appear once an agent is addressed in a space."
                        />
                    ),
                }}
            />
            <Typography.Text type="secondary" className="text-xs">
                {threads.length} thread{threads.length === 1 ? "" : "s"}
            </Typography.Text>
        </section>
    )
}

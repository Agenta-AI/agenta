import {useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Plus} from "@phosphor-icons/react"
import {Button, Descriptions, Drawer, Empty, Skeleton, Table, Typography} from "antd"

import {fetchChannelAgent, useChannelGrantsQuery} from "@/oss/state/channels"

import GrantFormDrawer from "./GrantFormDrawer"

export interface AgentDetailDrawerProps {
    agentId: string | null
    open: boolean
    onClose: () => void
    onEdit: (agentId: string) => void
}

export default function AgentDetailDrawer({
    agentId,
    open,
    onClose,
    onEdit,
}: AgentDetailDrawerProps) {
    const [agent, setAgent] = useState<AgentaApi.ChannelAgent | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [grantFormOpen, setGrantFormOpen] = useState(false)
    const {grants} = useChannelGrantsQuery()

    useEffect(() => {
        if (!open || !agentId) {
            setAgent(null)
            return
        }
        setIsLoading(true)
        fetchChannelAgent(agentId)
            .then((res) => setAgent(res.agent ?? null))
            .finally(() => setIsLoading(false))
    }, [open, agentId])

    const agentGrants = grants.filter((g) => g.agent_id === agentId)

    return (
        <>
            <Drawer
                title={agent?.name || agent?.slug || "Agent"}
                open={open}
                onClose={onClose}
                width={520}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={onClose}>Close</Button>
                        <Button type="primary" onClick={() => agentId && onEdit(agentId)}>
                            Edit
                        </Button>
                    </div>
                }
            >
                {isLoading ? (
                    <Skeleton active paragraph={{rows: 6}} />
                ) : agent ? (
                    <div className="flex flex-col gap-6">
                        <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="Slug">{agent.slug}</Descriptions.Item>
                            <Descriptions.Item label="Connection">
                                {agent.connection_id}
                            </Descriptions.Item>
                            <Descriptions.Item label="Active">
                                {(agent.flags?.is_active ?? true) ? "Yes" : "No"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Connection default">
                                {agent.flags?.is_default ? "Yes" : "No"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Reference">
                                {Object.entries(agent.data.references ?? {})
                                    .map(([key, ref]) => `${key}: ${ref.id ?? ref.slug ?? ""}`)
                                    .join(", ") || "-"}
                            </Descriptions.Item>
                        </Descriptions>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Typography.Text strong>Grants</Typography.Text>
                                <Button
                                    size="small"
                                    icon={<Plus size={14} />}
                                    onClick={() => setGrantFormOpen(true)}
                                >
                                    Grant space
                                </Button>
                            </div>
                            <Table<AgentaApi.ChannelGrant>
                                size="small"
                                bordered
                                pagination={false}
                                dataSource={agentGrants}
                                rowKey={(record) => record.id ?? ""}
                                columns={[
                                    {title: "Space", dataIndex: "space_id", key: "space_id"},
                                    {
                                        title: "Default",
                                        key: "is_default",
                                        render: (_, record) =>
                                            record.flags?.is_default ? "Yes" : "No",
                                    },
                                ]}
                                locale={{emptyText: <Empty description="No grants yet" />}}
                            />
                        </div>
                    </div>
                ) : (
                    <Empty description="Agent not found" />
                )}
            </Drawer>
            <GrantFormDrawer
                open={grantFormOpen}
                onClose={() => setGrantFormOpen(false)}
                initialAgentId={agentId ?? undefined}
            />
        </>
    )
}

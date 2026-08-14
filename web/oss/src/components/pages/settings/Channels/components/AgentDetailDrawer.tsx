import {useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Button, Descriptions, Drawer, Empty, Skeleton} from "antd"

import {fetchChannelAgent, useChannelGrantsQuery, useChannelSpacesQuery} from "@/oss/state/channels"

import GrantChannelsSection from "./GrantChannelsSection"
import GrantKindSection from "./GrantKindSection"

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
    const {grants} = useChannelGrantsQuery()
    const {spaces} = useChannelSpacesQuery()

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

    return (
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

                    {/* Three questions, not a bare table — an unanswered question
                        reads as refused, exactly like a denied one. */}
                    <div className="flex flex-col gap-4">
                        <GrantKindSection
                            agentId={agent.id ?? ""}
                            kind="private"
                            label="Direct messages"
                            description="Whether this agent answers a DM opened with it."
                            grants={grants}
                        />
                        <GrantKindSection
                            agentId={agent.id ?? ""}
                            kind="group"
                            label="Group chats"
                            description="Whether this agent answers in an ad-hoc group conversation."
                            grants={grants}
                        />
                        <GrantChannelsSection
                            agentId={agent.id ?? ""}
                            connectionId={agent.connection_id}
                            grants={grants}
                            spaces={spaces}
                        />
                    </div>
                </div>
            ) : (
                <Empty description="Agent not found" />
            )}
        </Drawer>
    )
}

import {useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Button, Drawer, Empty, List, Select, Skeleton, Tag, Typography, message} from "antd"

import {useChannelConnectionsQuery, useChannelSpaceActions} from "@/oss/state/channels"

export interface SpaceDiscoveryDrawerProps {
    open: boolean
    onClose: () => void
}

/**
 * Discovery picker over `discover_channel_spaces`: places the connected app
 * can see, `is_configured` distinguishing rows already backed by a
 * `channel_spaces` row. Choosing an unconfigured candidate calls
 * `create_channel_space`; choosing a configured one just closes (the space
 * list itself is the entry to its detail screen — no duplicate created).
 */
export default function SpaceDiscoveryDrawer({open, onClose}: SpaceDiscoveryDrawerProps) {
    const {connections} = useChannelConnectionsQuery()
    const {discover, create} = useChannelSpaceActions()
    const [connectionId, setConnectionId] = useState<string | undefined>(undefined)
    const [candidates, setCandidates] = useState<AgentaApi.ChannelSpaceCandidate[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [creatingKey, setCreatingKey] = useState<string | null>(null)

    const handleDiscover = async (nextConnectionId: string) => {
        setConnectionId(nextConnectionId)
        setIsLoading(true)
        try {
            const res = await discover(nextConnectionId)
            setCandidates(res.candidates ?? [])
        } catch {
            message.error("Failed to discover spaces")
        } finally {
            setIsLoading(false)
        }
    }

    const handleChoose = async (candidate: AgentaApi.ChannelSpaceCandidate) => {
        if (candidate.is_configured) {
            onClose()
            return
        }
        if (!connectionId) return
        const key = JSON.stringify(candidate.external_locator)
        setCreatingKey(key)
        try {
            await create({
                connection_id: connectionId,
                kind: candidate.kind,
                // The service always overwrites this with a derived uuid5 from
                // the locator — the wire schema requires a
                // syntactically valid UUID here, but the value is discarded.
                external_key: crypto.randomUUID(),
                data: {external_locator: candidate.external_locator},
            })
            message.success("Space created")
            onClose()
        } catch {
            message.error("Failed to create space")
        } finally {
            setCreatingKey(null)
        }
    }

    return (
        <Drawer title="Discover spaces" open={open} onClose={onClose} width={480} destroyOnClose>
            <div className="flex flex-col gap-4">
                <Select
                    placeholder="Select a connection"
                    style={{width: "100%"}}
                    options={connections.map((c) => ({
                        label: c.name || c.slug || c.integration_key,
                        value: c.id,
                    }))}
                    onChange={handleDiscover}
                />
                {isLoading ? (
                    <Skeleton active paragraph={{rows: 4}} />
                ) : candidates.length === 0 ? (
                    <Empty description="No candidates yet — select a connection" />
                ) : (
                    <List
                        dataSource={candidates}
                        renderItem={(candidate) => (
                            <List.Item
                                actions={[
                                    <Button
                                        key="choose"
                                        size="small"
                                        type={candidate.is_configured ? "default" : "primary"}
                                        loading={
                                            creatingKey ===
                                            JSON.stringify(candidate.external_locator)
                                        }
                                        onClick={() => handleChoose(candidate)}
                                    >
                                        {candidate.is_configured ? "Open" : "Configure"}
                                    </Button>,
                                ]}
                            >
                                <div className="flex items-center gap-2">
                                    <Typography.Text>
                                        {candidate.display_name || candidate.kind}
                                    </Typography.Text>
                                    {candidate.is_configured ? (
                                        <Tag color="green">Configured</Tag>
                                    ) : (
                                        <Tag>Not configured</Tag>
                                    )}
                                </div>
                            </List.Item>
                        )}
                    />
                )}
            </div>
        </Drawer>
    )
}

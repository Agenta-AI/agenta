import {useCallback, useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Plus, Star} from "@phosphor-icons/react"
import {Button, Descriptions, Drawer, Empty, Skeleton, Table, Typography, message} from "antd"

import {
    fetchChannelSpace,
    useChannelGrantActions,
    useChannelGrantsQuery,
    useChannelPolicyResolve,
    useChannelSpaceActions,
} from "@/oss/state/channels"

import GrantFormDrawer from "./GrantFormDrawer"
import {PolicyEditor} from "./PolicyEditor"

export interface SpaceDetailDrawerProps {
    spaceId: string | null
    open: boolean
    onClose: () => void
}

export default function SpaceDetailDrawer({spaceId, open, onClose}: SpaceDetailDrawerProps) {
    const [space, setSpace] = useState<AgentaApi.ChannelSpace | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [policy, setPolicy] = useState<AgentaApi.ChannelPolicy>({})
    const [grantFormOpen, setGrantFormOpen] = useState(false)
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
    const {edit} = useChannelSpaceActions()
    const {setDefault: setGrantDefault} = useChannelGrantActions()
    const {grants} = useChannelGrantsQuery()
    const {policy: effectivePolicy, refresh} = useChannelPolicyResolve(selectedAgentId, spaceId)

    const spaceGrants = grants.filter((g) => g.space_id === spaceId)

    const load = useCallback(() => {
        if (!spaceId) return
        setIsLoading(true)
        fetchChannelSpace(spaceId)
            .then((res) => {
                setSpace(res.space ?? null)
                setPolicy(res.space?.data.policy ?? {})
            })
            .finally(() => setIsLoading(false))
    }, [spaceId])

    useEffect(() => {
        if (!open || !spaceId) {
            setSpace(null)
            setSelectedAgentId(null)
            return
        }
        load()
    }, [open, spaceId, load])

    useEffect(() => {
        if (spaceGrants.length && !selectedAgentId) {
            setSelectedAgentId(spaceGrants[0].agent_id)
        }
    }, [spaceGrants.length])

    const handleSave = async () => {
        if (!space?.id) return
        setIsSaving(true)
        try {
            await edit(space.id, {
                id: space.id,
                name: space.name,
                data: {external_locator: space.data.external_locator, policy},
                flags: space.flags ?? {},
            })
            message.success("Space updated")
            await refresh()
            load()
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save space")
        } finally {
            setIsSaving(false)
        }
    }

    const handleSetGrantDefault = async (grant: AgentaApi.ChannelGrant) => {
        if (!grant.id) return
        try {
            await setGrantDefault(grant.id)
            message.success("Set as space default")
        } catch {
            message.error("Failed to set default")
        }
    }

    return (
        <>
            <Drawer
                title={space?.name || space?.external_key || "Space"}
                open={open}
                onClose={onClose}
                width={520}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={onClose}>Close</Button>
                        <Button type="primary" onClick={handleSave} loading={isSaving}>
                            Save
                        </Button>
                    </div>
                }
            >
                {isLoading ? (
                    <Skeleton active paragraph={{rows: 6}} />
                ) : space ? (
                    <div className="flex flex-col gap-6">
                        <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="Kind">{space.kind}</Descriptions.Item>
                            <Descriptions.Item label="Active">
                                {(space.flags?.is_active ?? true) ? "Yes" : "No"}
                            </Descriptions.Item>
                            <Descriptions.Item label="Backfilled">
                                {space.flags?.is_backfilled ? "Yes" : "No"}
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
                                    Grant agent
                                </Button>
                            </div>
                            <Table<AgentaApi.ChannelGrant>
                                size="small"
                                bordered
                                pagination={false}
                                dataSource={spaceGrants}
                                rowKey={(record) => record.id ?? ""}
                                onRow={(record) => ({
                                    onClick: () => setSelectedAgentId(record.agent_id),
                                    className: "cursor-pointer",
                                })}
                                columns={[
                                    {title: "Agent", dataIndex: "agent_id", key: "agent_id"},
                                    {
                                        title: "Default",
                                        key: "is_default",
                                        render: (_, record) =>
                                            record.flags?.is_default ? (
                                                "Yes"
                                            ) : (
                                                <Button
                                                    size="small"
                                                    type="link"
                                                    icon={<Star size={12} />}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleSetGrantDefault(record)
                                                    }}
                                                >
                                                    Set default
                                                </Button>
                                            ),
                                    },
                                ]}
                                locale={{emptyText: <Empty description="No grants yet" />}}
                            />
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="text-xs font-medium text-colorTextSecondary">
                                Policy
                            </div>
                            <PolicyEditor
                                value={policy}
                                onChange={setPolicy}
                                decidedBy={effectivePolicy?.decided_by}
                                editingLevel="space"
                            />
                        </div>
                    </div>
                ) : (
                    <Empty description="Space not found" />
                )}
            </Drawer>
            <GrantFormDrawer
                open={grantFormOpen}
                onClose={() => setGrantFormOpen(false)}
                initialSpaceId={spaceId ?? undefined}
                onSaved={load}
            />
        </>
    )
}

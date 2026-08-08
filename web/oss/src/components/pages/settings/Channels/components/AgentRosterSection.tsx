import {useCallback, useMemo, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {MoreOutlined} from "@ant-design/icons"
import {GearSix, Plus, Robot, Star, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useChannelAgentActions, useChannelAgentsQuery} from "@/oss/state/channels"

import AgentDetailDrawer from "./AgentDetailDrawer"
import AgentFormDrawer from "./AgentFormDrawer"
import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"

export default function AgentRosterSection() {
    const {agents, isLoading} = useChannelAgentsQuery()
    const {remove, setDefault} = useChannelAgentActions()
    const [formOpen, setFormOpen] = useState(false)
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
    const [detailAgentId, setDetailAgentId] = useState<string | null>(null)

    const openCreate = useCallback(() => {
        setEditingAgentId(null)
        setFormOpen(true)
    }, [])

    const openDetail = useCallback((record: AgentaApi.ChannelAgent) => {
        if (record.id) setDetailAgentId(record.id)
    }, [])

    const confirmDelete = useCallback(
        (record: AgentaApi.ChannelAgent) => {
            AlertPopup({
                title: "Delete agent",
                message: "Are you sure you want to delete this agent? This action is irreversible.",
                onOk: async () => {
                    if (!record.id) return
                    try {
                        await remove(record.id)
                        message.success("Agent deleted")
                    } catch {
                        message.error("Failed to delete agent")
                    }
                },
            })
        },
        [remove],
    )

    const handleSetDefault = useCallback(
        async (record: AgentaApi.ChannelAgent) => {
            if (!record.id) return
            try {
                await setDefault(record.id)
                message.success("Set as connection default")
            } catch {
                message.error("Failed to set default")
            }
        },
        [setDefault],
    )

    const columns: ColumnsType<AgentaApi.ChannelAgent> = useMemo(
        () => [
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
                title: "Active",
                key: "is_active",
                render: (_, record) =>
                    (record.flags?.is_active ?? true) ? (
                        <Tag color="green">Active</Tag>
                    ) : (
                        <Tag>Paused</Tag>
                    ),
            },
            {
                title: "Default",
                key: "is_default",
                render: (_, record) =>
                    record.flags?.is_default ? <Tag color="gold">Default</Tag> : null,
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 48,
                fixed: "right",
                align: "center",
                render: (_, record) => (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "default",
                                    label: "Set as connection default",
                                    icon: <Star size={16} />,
                                    disabled: !!record.flags?.is_default,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleSetDefault(record)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        confirmDelete(record)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            icon={<MoreOutlined />}
                            aria-label="Open agent actions"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Dropdown>
                ),
            },
        ],
        [confirmDelete, handleSetDefault],
    )

    return (
        <>
            <section className="flex flex-col gap-3">
                <ChannelsSectionHeader
                    icon={<Robot size={16} />}
                    title="Agent roster"
                    description="Agents this connection can reach, addressed by slug."
                    actions={
                        <Button
                            type="primary"
                            size="small"
                            icon={<Plus size={14} />}
                            onClick={openCreate}
                        >
                            New agent
                        </Button>
                    }
                />
                <Table<AgentaApi.ChannelAgent>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={agents}
                    rowKey={(record) => record.id ?? record.slug ?? ""}
                    bordered
                    pagination={false}
                    loading={isLoading}
                    locale={{
                        emptyText: isLoading ? (
                            <span />
                        ) : (
                            <ChannelsEmptyState
                                icon={<Robot size={32} />}
                                title="No agents yet"
                                description="Create an agent to give it a slug and bind it to a workflow."
                            />
                        ),
                    }}
                    onRow={(record) => ({
                        onClick: () => openDetail(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <AgentFormDrawer
                open={formOpen}
                onClose={() => setFormOpen(false)}
                agentId={editingAgentId}
            />
            <AgentDetailDrawer
                agentId={detailAgentId}
                open={!!detailAgentId}
                onClose={() => setDetailAgentId(null)}
                onEdit={(id) => {
                    setDetailAgentId(null)
                    setEditingAgentId(id)
                    setFormOpen(true)
                }}
            />
        </>
    )
}

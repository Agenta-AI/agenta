import {useCallback, useMemo, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {MoreOutlined} from "@ant-design/icons"
import {Compass, GearSix, Hash, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useChannelSpaceActions, useChannelSpacesQuery} from "@/oss/state/channels"

import {ChannelsEmptyState, ChannelsSectionHeader} from "./ChannelsSection"
import SpaceDetailDrawer from "./SpaceDetailDrawer"
import SpaceDiscoveryDrawer from "./SpaceDiscoveryDrawer"

export default function SpacesSection() {
    const {spaces, isLoading} = useChannelSpacesQuery()
    const {remove} = useChannelSpaceActions()
    const [discoveryOpen, setDiscoveryOpen] = useState(false)
    const [detailSpaceId, setDetailSpaceId] = useState<string | null>(null)

    const openDetail = useCallback((record: AgentaApi.ChannelSpace) => {
        if (record.id) setDetailSpaceId(record.id)
    }, [])

    const confirmDelete = useCallback(
        (record: AgentaApi.ChannelSpace) => {
            AlertPopup({
                title: "Delete space",
                message: "Are you sure you want to delete this space? This action is irreversible.",
                onOk: async () => {
                    if (!record.id) return
                    try {
                        await remove(record.id)
                        message.success("Space deleted")
                    } catch {
                        message.error("Failed to delete space")
                    }
                },
            })
        },
        [remove],
    )

    const columns: ColumnsType<AgentaApi.ChannelSpace> = useMemo(
        () => [
            {
                title: "Name",
                key: "name",
                render: (_, record) => (
                    <Typography.Text>{record.name || record.external_key}</Typography.Text>
                ),
            },
            {
                title: "Kind",
                key: "kind",
                render: (_, record) => <Tag bordered={false}>{record.kind}</Tag>,
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
                title: "Backfilled",
                key: "is_backfilled",
                render: (_, record) => (record.flags?.is_backfilled ? "Yes" : "No"),
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
                            aria-label="Open space actions"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Dropdown>
                ),
            },
        ],
        [confirmDelete],
    )

    return (
        <>
            <section className="flex flex-col gap-3">
                <ChannelsSectionHeader
                    icon={<Hash size={16} />}
                    title="Spaces"
                    description="Where agents may answer, and the rules that hold whoever acts there."
                    actions={
                        <Button
                            type="primary"
                            size="small"
                            icon={<Compass size={14} />}
                            onClick={() => setDiscoveryOpen(true)}
                        >
                            Discover
                        </Button>
                    }
                />
                <Table<AgentaApi.ChannelSpace>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={spaces}
                    rowKey={(record) => record.id ?? record.external_key}
                    bordered
                    pagination={false}
                    loading={isLoading}
                    locale={{
                        emptyText: isLoading ? (
                            <span />
                        ) : (
                            <ChannelsEmptyState
                                icon={<Hash size={32} />}
                                title="No spaces configured yet"
                                description="Discover places the connected app can see, and choose one to configure."
                            />
                        ),
                    }}
                    onRow={(record) => ({
                        onClick: () => openDetail(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <SpaceDiscoveryDrawer open={discoveryOpen} onClose={() => setDiscoveryOpen(false)} />
            <SpaceDetailDrawer
                spaceId={detailSpaceId}
                open={!!detailSpaceId}
                onClose={() => setDetailSpaceId(null)}
            />
        </>
    )
}

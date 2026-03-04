import {useCallback, useMemo, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Lightning, PencilLineIcon, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, Modal, Tag, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import CreateWebhookDrawer from "@/oss/components/Webhooks/CreateWebhookDrawer"
import {WebhookSubscription} from "@/oss/services/webhooks/types"
import {deleteWebhookAtom, testWebhookAtom, webhooksAtom} from "@/oss/state/webhooks/atoms"
import {editingWebhookAtom, isCreateWebhookModalOpenAtom} from "@/oss/state/webhooks/state"

const {Title} = Typography

const Webhooks: React.FC = () => {
    const [{data: webhooks, isPending: isLoading}] = useAtom(webhooksAtom)
    const setIsModalOpen = useSetAtom(isCreateWebhookModalOpenAtom)
    const setEditingWebhook = useSetAtom(editingWebhookAtom)
    const deleteWebhook = useSetAtom(deleteWebhookAtom)
    const testWebhook = useSetAtom(testWebhookAtom)

    const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null)

    const handleCreate = useCallback(() => {
        setEditingWebhook(undefined)
        setIsModalOpen(true)
    }, [setEditingWebhook, setIsModalOpen])

    const handleEdit = useCallback(
        (webhook: WebhookSubscription) => {
            setEditingWebhook(webhook)
            setIsModalOpen(true)
        },
        [setEditingWebhook, setIsModalOpen],
    )

    const handleDelete = useCallback(
        (webhook: WebhookSubscription) => {
            Modal.confirm({
                title: "Delete Webhook",
                content: "Are you sure you want to delete this webhook?",
                onOk: async () => {
                    try {
                        await deleteWebhook(webhook.id)
                        message.success("Webhook deleted successfully")
                    } catch (error) {
                        message.error("Failed to delete webhook")
                    }
                },
            })
        },
        [deleteWebhook],
    )

    const handleTestWebhook = useCallback(
        async (webhook: WebhookSubscription) => {
            try {
                setTestingWebhookId(webhook.id)
                const response = await testWebhook(webhook.id)
                const delivery = response?.delivery

                if (delivery?.status?.code === "success" || delivery?.status?.type === "success") {
                    message.success(
                        `Connection successful! Status: ${delivery.data?.response?.status_code || 200}`,
                        10,
                    )
                } else {
                    message.error(
                        `Connection failed. ${delivery?.status?.message || "Unknown error"}`,
                        10,
                    )
                }
            } catch (error) {
                console.error(error)
                message.error("Failed to test connection")
            } finally {
                setTestingWebhookId(null)
            }
        },
        [testWebhook],
    )

    const handleModalSuccess = useCallback(() => {
        setIsModalOpen(false)
        setEditingWebhook(undefined)
    }, [setIsModalOpen, setEditingWebhook])

    const webhooksWithKey = useMemo(() => webhooks?.map((w) => ({...w, key: w.id})), [webhooks])

    const columns: EnhancedColumnType<WebhookSubscription & {key: string}>[] = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                width: 200,
                render: (name: string) => <Typography.Text>{name}</Typography.Text>,
                fixed: "left",
            },
            {
                title: "URL",
                dataIndex: ["data", "url"],
                key: "url",
                width: 250,
                render: (url: string) => (
                    <Tag
                        className="max-w-[250px] truncate"
                        title={url} // Show full URL on hover
                    >
                        {url}
                    </Tag>
                ),
            },
            {
                title: "Events",
                dataIndex: ["data", "event_types"],
                key: "events",
                render: (events: string[]) => (
                    <>
                        {events?.map((event) => (
                            <Tag key={event}>{event}</Tag>
                        ))}
                    </>
                ),
            },

            {
                title: "Created At",
                dataIndex: "created_at",
                key: "created_at",
                width: 200,
                render: (date: string) => new Date(date).toLocaleString(),
            },
            {
                title: "Actions",
                key: "actions",
                width: 80,
                align: "center",
                render: (_: any, record: WebhookSubscription) => {
                    const items: MenuProps["items"] = [
                        {
                            key: "test",
                            label:
                                testingWebhookId === record.id ? "Testing..." : "Test Connection",
                            icon: <Lightning size={14} />,
                            disabled: testingWebhookId !== null,
                            onClick: () => handleTestWebhook(record),
                        },
                        {
                            type: "divider",
                        },
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilLineIcon size={14} />,
                            onClick: () => handleEdit(record),
                        },
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={14} />,
                            danger: true,
                            onClick: () => handleDelete(record),
                        },
                    ]

                    return (
                        <Dropdown
                            menu={{items, style: {width: 150}}}
                            trigger={["click"]}
                            placement="bottomRight"
                        >
                            <Button type="text" icon={<MoreOutlined />} />
                        </Dropdown>
                    )
                },
            },
        ],
        [handleEdit, handleDelete, handleTestWebhook, testingWebhookId],
    )

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="flex items-center gap-3">
                <Title level={4} className="!m-0">
                    Webhooks
                </Title>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
                    Create Webhook
                </Button>
            </div>

            <EnhancedTable
                columns={columns}
                dataSource={webhooksWithKey}
                loading={isLoading}
                rowKey="id"
                uniqueKey="webhooks-table"
            />

            <CreateWebhookDrawer onSuccess={handleModalSuccess} />
        </div>
    )
}

export default Webhooks

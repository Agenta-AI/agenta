import {useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Dropdown, MenuProps, Modal, Switch, Tag, Typography, message} from "antd"
import {useAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import CreateWebhookModal from "@/oss/components/Webhooks/CreateWebhookModal"
import {deleteWebhook, updateWebhook} from "@/oss/services/webhooks/api"
import {WebhookSubscription, WebhookSubscriptionEditRequest} from "@/oss/services/webhooks/types"
import {webhooksAtom} from "@/oss/state/webhooks/atoms"
import {PencilLineIcon, Trash} from "@phosphor-icons/react"

const {Title} = Typography

const Webhooks: React.FC = () => {
    const [{data: webhooks, refetch, isPending: isLoading}] = useAtom(webhooksAtom)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingWebhook, setEditingWebhook] = useState<WebhookSubscription | undefined>(undefined)

    const handleCreate = () => {
        setEditingWebhook(undefined)
        setIsModalOpen(true)
    }

    const handleEdit = (webhook: WebhookSubscription) => {
        setEditingWebhook(webhook)
        setIsModalOpen(true)
    }

    const handleDelete = (webhook: WebhookSubscription) => {
        Modal.confirm({
            title: "Delete Webhook",
            content: "Are you sure you want to delete this webhook?",
            onOk: async () => {
                try {
                    await deleteWebhook(webhook.id)
                    message.success("Webhook deleted successfully")
                    refetch()
                } catch (error) {
                    message.error("Failed to delete webhook")
                }
            },
        })
    }

    const handleToggleActive = async (webhook: WebhookSubscription, checked: boolean) => {
        try {
            const payload: WebhookSubscriptionEditRequest = {
                subscription: {
                    id: webhook.id,
                    name: webhook.name,
                    flags: {is_valid: checked},
                    data: {
                        url: webhook.data.url,
                        event_types: webhook.data.event_types,
                    },
                },
            }
            // Optimistic update could be done here, but refetch is safer
            await updateWebhook(webhook.id, payload)
            message.success(`Webhook ${checked ? "activated" : "deactivated"}`)
            refetch()
        } catch (error) {
            message.error("Failed to update status")
        }
    }

    const handleModalSuccess = () => {
        setIsModalOpen(false)
        setEditingWebhook(undefined)
        refetch()
    }

    const webhooksWithKey = webhooks?.map((w) => ({...w, key: w.id}))

    const columns: EnhancedColumnType<WebhookSubscription & {key: string}>[] = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            width: 200,
            render: (name: string) => <Typography.Text>{name}</Typography.Text>,
        },
        {
            title: "URL",
            dataIndex: ["data", "url"],
            key: "url",
            width: 300,
            render: (url: string) => (
                <Tag
                    className="max-w-[200px] truncate"
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
            title: "Active",
            dataIndex: ["flags", "is_valid"],
            key: "is_valid",
            width: 100,
            render: (isValid: boolean, record) => (
                <Switch
                    // Provide a default fallback if is_valid is undefined in flags
                    checked={isValid ?? true}
                    onChange={(checked) => handleToggleActive(record, checked)}
                />
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
    ]

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="flex justify-between items-center">
                <Title level={4} className="!m-0">
                    Webhooks
                </Title>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
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

            <CreateWebhookModal
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                onSuccess={handleModalSuccess}
                initialValues={editingWebhook}
            />
        </div>
    )
}

export default Webhooks

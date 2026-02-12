import {useState} from "react"

import {DeleteOutlined, EditOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Modal, Space, Switch, Tag, Typography, message} from "antd"
import {useAtom} from "jotai"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import CreateWebhookModal from "@/oss/components/Webhooks/CreateWebhookModal"
import {deleteWebhook, updateWebhook} from "@/oss/services/webhooks/api"
import {WebhookSubscription} from "@/oss/services/webhooks/types"
import {useOrgData} from "@/oss/state/org"
import {webhooksAtom} from "@/oss/state/webhooks/atoms"

const {Title} = Typography

const Webhooks: React.FC = () => {
    const [{data: webhooks, refetch, isPending: isLoading}] = useAtom(webhooksAtom)
    const {selectedOrg} = useOrgData()
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
                const workspaceId = selectedOrg?.default_workspace?.id
                if (!workspaceId) return
                try {
                    await deleteWebhook(workspaceId, webhook.id)
                    message.success("Webhook deleted successfully")
                    refetch()
                } catch (error) {
                    message.error("Failed to delete webhook")
                }
            },
        })
    }

    const handleToggleActive = async (webhook: WebhookSubscription, checked: boolean) => {
        const workspaceId = selectedOrg?.default_workspace?.id
        if (!workspaceId) return
        try {
            // Optimistic update could be done here, but refetch is safer
            await updateWebhook(workspaceId, webhook.id, {is_active: checked})
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
            title: "URL",
            dataIndex: "url",
            key: "url",
            width: 300,
            render: (url: string) => <Typography.Text copyable>{url}</Typography.Text>,
        },
        {
            title: "Events",
            dataIndex: "events",
            key: "events",
            render: (events: string[]) => (
                <>
                    {events.map((event) => (
                        <Tag key={event}>{event}</Tag>
                    ))}
                </>
            ),
        },
        {
            title: "Active",
            dataIndex: "is_active",
            key: "is_active",
            width: 100,
            render: (isActive: boolean, record) => (
                <Switch
                    checked={isActive}
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
            width: 100,
            render: (_: any, record: WebhookSubscription) => (
                <Space>
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(record)}
                    />
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(record)}
                    />
                </Space>
            ),
        },
    ]

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="flex justify-between items-center">
                <Title level={4} style={{margin: 0}}>
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

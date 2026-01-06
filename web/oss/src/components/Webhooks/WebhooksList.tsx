/**
 * Webhooks list component
 */

import {FC, useState, useEffect} from "react"
import {Table, Button, Space, Tag, Popconfirm, Typography, Tooltip} from "antd"
import {PlayCircleOutlined, EditOutlined, DeleteOutlined, HistoryOutlined} from "@ant-design/icons"

import {message} from "@/oss/components/AppMessageContext"
import {webhookService} from "@/oss/services/webhooks/api"
import type {Webhook} from "@/oss/services/webhooks/types"
import WebhookConfigModal from "./WebhookConfigModal"
import WebhookExecutionsModal from "./WebhookExecutionsModal"

const {Text} = Typography

interface WebhooksListProps {
    appId: string
}

const WebhooksList: FC<WebhooksListProps> = ({appId}) => {
    const [webhooks, setWebhooks] = useState<Webhook[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null)
    const [modalMode, setModalMode] = useState<"create" | "edit">("create")
    const [modalVisible, setModalVisible] = useState(false)
    const [executionsModalVisible, setExecutionsModalVisible] = useState(false)

    // Load webhooks
    const loadWebhooks = async () => {
        setLoading(true)
        try {
            const data = await webhookService.listWebhooks(appId)
            setWebhooks(data)
        } catch (error: any) {
            message.error("Failed to load webhooks")
        } finally {
            setLoading(false)
        }
    }

    // Initial load
    useEffect(() => {
        loadWebhooks()
    }, [appId])

    const handleCreate = () => {
        setSelectedWebhook(null)
        setModalMode("create")
        setModalVisible(true)
    }

    const handleEdit = (webhook: Webhook) => {
        setSelectedWebhook(webhook)
        setModalMode("edit")
        setModalVisible(true)
    }

    const handleDelete = async (webhookId: string) => {
        try {
            await webhookService.deleteWebhook(webhookId)
            message.success("Webhook deleted")
            loadWebhooks()
        } catch (error: any) {
            message.error("Failed to delete webhook")
        }
    }

    const handleViewExecutions = (webhook: Webhook) => {
        setSelectedWebhook(webhook)
        setExecutionsModalVisible(true)
    }

    const columns = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            render: (text: string, record: Webhook) => (
                <Space>
                    <Text strong={record.is_enabled}>{text}</Text>
                    {!record.is_enabled && <Tag color="default">Disabled</Tag>}
                </Space>
            ),
        },
        {
            title: "Description",
            dataIndex: "description",
            key: "description",
            ellipsis: true,
            render: (text: string) => text || "-",
        },
        {
            title: "Trigger Environments",
            dataIndex: "trigger_on_environments",
            key: "trigger_on_environments",
            render: (envs: string[]) => (
                <>
                    {envs.length === 0 ? (
                        <Tag>All</Tag>
                    ) : (
                        envs.map((env) => (
                            <Tag key={env}>{env}</Tag>
                        ))
                    )}
                </>
            ),
        },
        {
            title: "Retry",
            key: "retry",
            render: (_: any, record: Webhook) => (
                record.retry_on_failure ? (
                    <Tooltip title={`Max ${record.max_retries} retries, ${record.retry_delay_seconds}s delay`}>
                        <Tag color="blue">Enabled</Tag>
                    </Tooltip>
                ) : (
                    <Tag>Disabled</Tag>
                )
            ),
        },
        {
            title: "Docker Image",
            dataIndex: "docker_image",
            key: "docker_image",
            ellipsis: true,
            render: (text: string) => (
                <Tooltip title={text}>
                    <Text ellipsis style={{maxWidth: 150}}>
                        {text}
                    </Text>
                </Tooltip>
            ),
        },
        {
            title: "Actions",
            key: "actions",
            width: 200,
            render: (_: any, record: Webhook) => (
                <Space size="small">
                    <Tooltip title="View execution history">
                        <Button
                            type="text"
                            icon={<HistoryOutlined />}
                            onClick={() => handleViewExecutions(record)}
                        />
                    </Tooltip>
                    <Tooltip title="Edit">
                        <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                            disabled={!record.is_enabled}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Delete this webhook?"
                        onConfirm={() => handleDelete(record.id)}
                        okText="Yes"
                        cancelText="No"
                    >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ]

    return (
        <>
            <div style={{display: "flex", justifyContent: "space-between", marginBottom: 16}}>
                <Typography.Title level={4}>Webhooks</Typography.Title>
                <Button type="primary" onClick={handleCreate}>
                    Create Webhook
                </Button>
            </div>

            <Table
                columns={columns}
                dataSource={webhooks}
                rowKey="id"
                loading={loading}
                pagination={{pageSize: 10}}
                locale={{
                    emptyText: (
                        <div style={{padding: "40px", textAlign: "center"}}>
                            <Text type="secondary">No webhooks configured yet</Text>
                            <br />
                            <Button type="link" onClick={handleCreate}>
                                Create your first webhook
                            </Button>
                        </div>
                    ),
                }}
            />

            {modalVisible && (
                <WebhookConfigModal
                    visible={modalVisible}
                    onClose={() => {
                        setModalVisible(false)
                        loadWebhooks()
                    }}
                    appId={appId}
                    webhook={selectedWebhook}
                    mode={modalMode}
                />
            )}

            {executionsModalVisible && selectedWebhook && (
                <WebhookExecutionsModal
                    visible={executionsModalVisible}
                    onClose={() => setExecutionsModalVisible(false)}
                    webhook={selectedWebhook}
                />
            )}
        </>
    )
}

export default WebhooksList

/**
 * Webhook executions history modal
 */

import {FC, useState, useEffect} from "react"
import {Modal, Table, Tag, Typography, Space, Button} from "antd"
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    LoadingOutlined,
    ClockCircleOutlined,
} from "@ant-design/icons"

import {message} from "@/oss/components/AppMessageContext"
import {webhookService} from "@/oss/services/webhooks/api"
import type {Webhook, WebhookExecution} from "@/oss/services/webhooks/types"

const {Text, Paragraph} = Typography

interface WebhookExecutionsModalProps {
    visible: boolean
    onClose: () => void
    webhook: Webhook
}

const WebhookExecutionsModal: FC<WebhookExecutionsModalProps> = ({
    visible,
    onClose,
    webhook,
}) => {
    const [executions, setExecutions] = useState<WebhookExecution[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedExecution, setSelectedExecution] = useState<WebhookExecution | null>(null)
    const [detailModalVisible, setDetailModalVisible] = useState(false)

    const loadExecutions = async () => {
        setLoading(true)
        try {
            const data = await webhookService.listExecutions(webhook.id, 100, 0)
            setExecutions(data)
        } catch (error: any) {
            message.error("Failed to load executions")
        } finally {
            setLoading(false)
        }
    }

    // Load executions when modal opens
    useEffect(() => {
        if (visible) {
            loadExecutions()
        }
    }, [visible, webhook.id])

    const getStatusTag = (status: WebhookExecution["status"]) => {
        switch (status) {
            case "success":
                return <Tag icon={<CheckCircleOutlined />} color="success">Success</Tag>
            case "failed":
                return <Tag icon={<CloseCircleOutlined />} color="error">Failed</Tag>
            case "running":
                return <Tag icon={<LoadingOutlined />} color="processing">Running</Tag>
            case "pending":
                return <Tag icon={<ClockCircleOutlined />} color="default">Pending</Tag>
            case "timeout":
                return <Tag icon={<ClockCircleOutlined />} color="warning">Timeout</Tag>
            default:
                return <Tag>{status}</Tag>
        }
    }

    const columns = [
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            width: 120,
            render: (status: WebhookExecution["status"]) => getStatusTag(status),
        },
        {
            title: "Environment",
            dataIndex: "environment_name",
            key: "environment_name",
            width: 120,
        },
        {
            title: "Started",
            dataIndex: "started_at",
            key: "started_at",
            width: 180,
            render: (date: string | null) => (date ? new Date(date).toLocaleString() : "-"),
        },
        {
            title: "Duration",
            key: "duration",
            width: 100,
            render: (_: any, record: WebhookExecution) => {
                if (!record.started_at || !record.completed_at) return "-"
                const duration = new Date(record.completed_at).getTime() - new Date(record.started_at).getTime()
                return `${Math.round(duration / 1000)}s`
            },
        },
        {
            title: "Exit Code",
            dataIndex: "exit_code",
            key: "exit_code",
            width: 100,
            render: (code: number | null) => (code !== null ? code : "-"),
        },
        {
            title: "Retry",
            dataIndex: "retry_count",
            key: "retry_count",
            width: 80,
            render: (count: number, record: WebhookExecution) =>
                count > 0 ? <Tag color="orange">#{count}</Tag> : "-",
        },
        {
            title: "Actions",
            key: "actions",
            width: 100,
            render: (_: any, record: WebhookExecution) => (
                <Button
                    type="link"
                    onClick={() => {
                        setSelectedExecution(record)
                        setDetailModalVisible(true)
                    }}
                >
                    View Details
                </Button>
            ),
        },
    ]

    return (
        <>
            <Modal
                title={`Execution History: ${webhook.name}`}
                open={visible}
                onCancel={onClose}
                width={1000}
                footer={[
                    <Button key="close" onClick={onClose}>
                        Close
                    </Button>,
                ]}
            >
                <Table
                    columns={columns}
                    dataSource={executions}
                    rowKey="id"
                    loading={loading}
                    pagination={{pageSize: 10}}
                    size="small"
                />
            </Modal>

            {detailModalVisible && selectedExecution && (
                <Modal
                    title="Execution Details"
                    open={detailModalVisible}
                    onCancel={() => setDetailModalVisible(false)}
                    width={800}
                    footer={[
                        <Button key="close" onClick={() => setDetailModalVisible(false)}>
                            Close
                        </Button>,
                    ]}
                >
                    <Space direction="vertical" style={{width: "100%"}} size="large">
                        <div>
                            <Text strong>Status: </Text>
                            {getStatusTag(selectedExecution.status)}
                        </div>

                        <div>
                            <Text strong>Environment: </Text>
                            <Text>{selectedExecution.environment_name}</Text>
                        </div>

                        <div>
                            <Text strong>Started: </Text>
                            <Text>
                                {selectedExecution.started_at
                                    ? new Date(selectedExecution.started_at).toLocaleString()
                                    : "-"}
                            </Text>
                        </div>

                        <div>
                            <Text strong>Completed: </Text>
                            <Text>
                                {selectedExecution.completed_at
                                    ? new Date(selectedExecution.completed_at).toLocaleString()
                                    : "-"}
                            </Text>
                        </div>

                        <div>
                            <Text strong>Exit Code: </Text>
                            <Text>{selectedExecution.exit_code ?? "-"}</Text>
                        </div>

                        {selectedExecution.container_id && (
                            <div>
                                <Text strong>Container ID: </Text>
                                <Text code>{selectedExecution.container_id}</Text>
                            </div>
                        )}

                        {selectedExecution.output && (
                            <div>
                                <Text strong>Output:</Text>
                                <Paragraph>
                                    <pre
                                        style={{
                                            background: "#f5f5f5",
                                            padding: "12px",
                                            borderRadius: "4px",
                                            maxHeight: "300px",
                                            overflow: "auto",
                                        }}
                                    >
                                        {selectedExecution.output}
                                    </pre>
                                </Paragraph>
                            </div>
                        )}

                        {selectedExecution.error_output && (
                            <div>
                                <Text strong type="danger">
                                    Error Output:
                                </Text>
                                <Paragraph>
                                    <pre
                                        style={{
                                            background: "#fff2f0",
                                            padding: "12px",
                                            borderRadius: "4px",
                                            border: "1px solid #ffccc7",
                                            maxHeight: "300px",
                                            overflow: "auto",
                                        }}
                                    >
                                        {selectedExecution.error_output}
                                    </pre>
                                </Paragraph>
                            </div>
                        )}

                        {selectedExecution.is_retry && (
                            <div>
                                <Tag color="orange">Retry #{selectedExecution.retry_count}</Tag>
                                {selectedExecution.parent_execution_id && (
                                    <Text type="secondary">
                                        {" "}Parent execution: {selectedExecution.parent_execution_id}
                                    </Text>
                                )}
                            </div>
                        )}
                    </Space>
                </Modal>
            )}
        </>
    )
}

export default WebhookExecutionsModal

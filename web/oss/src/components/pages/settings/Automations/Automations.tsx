import {useCallback, useMemo, useState} from "react"

import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    PlusOutlined,
} from "@ant-design/icons"
import {Button, Card, Space, Table, Tag, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import AutomationDrawer from "@/oss/components/Automations/AutomationDrawer"
import DeleteAutomationModal from "@/oss/components/Automations/Modals/DeleteAutomationModal"
import SecretRevealModal from "@/oss/components/Automations/Modals/SecretRevealModal"
import {
    AUTOMATION_TEST_FAILURE_MESSAGE,
    handleTestResult,
} from "@/oss/components/Automations/utils/handleTestResult"
import {AutomationProvider, WebhookSubscription} from "@/oss/services/automations/types"
import {automationsAtom, testAutomationAtom} from "@/oss/state/automations/atoms"
import {
    editingAutomationAtom,
    isAutomationDrawerOpenAtom,
    webhookToDeleteAtom,
} from "@/oss/state/automations/state"

const {Title, Text} = Typography

const sectionTitleStyle = {margin: 0, fontSize: 20, fontWeight: 600}

const isGitHubApiUrl = (url?: string | null): boolean => {
    if (!url) {
        return false
    }
    try {
        const parsed = new URL(url)
        return parsed.hostname === "api.github.com"
    } catch {
        return false
    }
}

const getProviderLabel = (url?: string | null): AutomationProvider => {
    return isGitHubApiUrl(url) ? "github" : "webhook"
}

const formatDestination = (url?: string) => {
    if (!url) {
        return "-"
    }

    if (isGitHubApiUrl(url)) {
        const repoMatch = url.match(/repos\/([^\/]+\/[^\/]+)\//)
        if (repoMatch) {
            return repoMatch[1]
        }
    }

    return url
}

// const Instructions: React.FC = () => {
//     return null
// }

const Automations: React.FC = () => {
    const [{data: webhooks, isPending: isLoading}] = useAtom(automationsAtom)
    const setIsDrawerOpen = useSetAtom(isAutomationDrawerOpenAtom)
    const setEditingWebhook = useSetAtom(editingAutomationAtom)
    const testWebhookSubscription = useSetAtom(testAutomationAtom)
    const setWebhookToDelete = useSetAtom(webhookToDeleteAtom)

    const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null)

    const handleCreate = useCallback(() => {
        setEditingWebhook(undefined)
        setIsDrawerOpen(true)
    }, [setEditingWebhook, setIsDrawerOpen])

    const handleEdit = useCallback(
        (webhook: WebhookSubscription) => {
            setEditingWebhook(webhook)
            setIsDrawerOpen(true)
        },
        [setEditingWebhook, setIsDrawerOpen],
    )

    const handleDeleteClick = useCallback(
        (webhook: WebhookSubscription) => {
            setWebhookToDelete(webhook)
        },
        [setWebhookToDelete],
    )

    const handleTestWebhook = useCallback(
        async (webhook: WebhookSubscription) => {
            try {
                setTestingWebhookId(webhook.id)
                const response = await testWebhookSubscription(webhook.id)
                handleTestResult(response)
            } catch (error) {
                console.error(error)
                message.error(AUTOMATION_TEST_FAILURE_MESSAGE, 10)
            } finally {
                setTestingWebhookId(null)
            }
        },
        [testWebhookSubscription],
    )

    const handleModalSuccess = useCallback(() => {
        setIsDrawerOpen(false)
        setEditingWebhook(undefined)
    }, [setIsDrawerOpen, setEditingWebhook])

    const columns = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                ellipsis: true,
                render: (name: string | undefined) => <Text>{name || "-"}</Text>,
            },
            {
                title: "Type",
                key: "provider",
                render: (_: any, record: WebhookSubscription) => {
                    const provider = getProviderLabel(record.data?.url)
                    return <Text>{provider === "github" ? "GitHub" : "Webhook"}</Text>
                },
            },
            {
                title: "Target",
                dataIndex: ["data", "url"],
                key: "url",
                render: (url?: string) => (
                    <Text ellipsis style={{maxWidth: 320}} title={url}>
                        {formatDestination(url)}
                    </Text>
                ),
            },
            {
                title: "Events",
                dataIndex: ["data", "event_types"],
                key: "events",
                render: (events?: string[]) => {
                    const value = events?.join(", ") || "-"
                    return (
                        <Text ellipsis style={{maxWidth: 260}} title={value}>
                            {value}
                        </Text>
                    )
                },
            },
            {
                title: "Status",
                key: "status",
                render: (_: any, record: WebhookSubscription) => {
                    const isValid = record.flags?.is_valid === true
                    return isValid ? (
                        <Tag icon={<CheckCircleOutlined />} color="success">
                            Active
                        </Tag>
                    ) : (
                        <Tag icon={<ClockCircleOutlined />} color="warning">
                            Pending
                        </Tag>
                    )
                },
            },
            {
                title: "Actions",
                key: "actions",
                render: (_: any, record: WebhookSubscription) => {
                    return (
                        <Space>
                            <Button
                                type="primary"
                                size="small"
                                onClick={() => handleTestWebhook(record)}
                                loading={testingWebhookId === record.id}
                                disabled={
                                    testingWebhookId !== null && testingWebhookId !== record.id
                                }
                            >
                                Test
                            </Button>
                            <Button
                                size="small"
                                icon={<EditOutlined />}
                                aria-label="Edit automation"
                                onClick={() => handleEdit(record)}
                            />
                            <Button
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                aria-label="Delete automation"
                                onClick={() => handleDeleteClick(record)}
                            />
                        </Space>
                    )
                },
            },
        ],
        [handleDeleteClick, handleEdit, handleTestWebhook, testingWebhookId],
    )

    return (
        <div className="flex flex-col h-full gap-6">
            <Card>
                <Space direction="vertical" size="small" style={{width: "100%"}}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                        }}
                    >
                        <div>
                            <Title level={1} style={sectionTitleStyle} className="!mb-1">
                                Automations
                            </Title>
                            <Text type="secondary">
                                Configure webhook destinations for automation events
                            </Text>
                        </div>
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                            Add Automation
                        </Button>
                    </div>

                    <Table
                        columns={columns}
                        dataSource={webhooks ?? []}
                        loading={isLoading}
                        rowKey="id"
                        pagination={false}
                        size="small"
                        tableLayout="fixed"
                        className="no-expand-indent no-expand-col automations-table"
                    />

                    {/* <Instructions /> */}
                </Space>
            </Card>

            <AutomationDrawer onSuccess={handleModalSuccess} />

            <DeleteAutomationModal />

            <SecretRevealModal />
        </div>
    )
}

export default Automations

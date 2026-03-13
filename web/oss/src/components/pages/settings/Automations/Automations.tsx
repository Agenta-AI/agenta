import {useCallback, useMemo, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {GearSix, PencilSimpleLine, Play, Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Typography, message} from "antd"
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
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (name: string | undefined) => (
                    <Typography.Text>{name || "-"}</Typography.Text>
                ),
            },
            {
                title: "Type",
                key: "provider",
                onHeaderCell: () => ({
                    style: {minWidth: 100},
                }),
                render: (_: any, record: WebhookSubscription) => {
                    const provider = getProviderLabel(record.data?.url)
                    return (
                        <Typography.Text>
                            {provider === "github" ? "GitHub" : "Webhook"}
                        </Typography.Text>
                    )
                },
            },
            {
                title: "Target",
                dataIndex: ["data", "url"],
                key: "url",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (url?: string) => (
                    <Typography.Text ellipsis style={{maxWidth: 320}} title={url}>
                        {formatDestination(url)}
                    </Typography.Text>
                ),
            },
            {
                title: "Events",
                dataIndex: ["data", "event_types"],
                key: "events",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (events?: string[]) => {
                    const value = events?.join(", ") || "-"
                    return (
                        <Typography.Text ellipsis style={{maxWidth: 260}} title={value}>
                            {value}
                        </Typography.Text>
                    )
                },
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({
                    style: {minWidth: 120},
                }),
                render: () => <Tag color="success">Active</Tag>,
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 61,
                fixed: "right" as const,
                align: "center" as const,
                render: (_: any, record: WebhookSubscription) => (
                    <Dropdown
                        trigger={["click"]}
                        styles={{root: {width: 180}}}
                        menu={{
                            items: [
                                {
                                    key: "test",
                                    label: "Test",
                                    icon: <Play size={16} />,
                                    disabled: testingWebhookId !== null,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        handleTestWebhook(record)
                                    },
                                },
                                {
                                    key: "edit",
                                    label: "Edit",
                                    icon: <PencilSimpleLine size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        handleEdit(record)
                                    },
                                },
                                {type: "divider" as const},
                                {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        handleDeleteClick(record)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            icon={<MoreOutlined />}
                            loading={testingWebhookId === record.id}
                            aria-label="Open automation actions"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Dropdown>
                ),
            },
        ],
        [handleDeleteClick, handleEdit, handleTestWebhook, testingWebhookId],
    )

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button
                    type="primary"
                    size="small"
                    icon={<Plus size={14} />}
                    onClick={handleCreate}
                >
                    Add Automation
                </Button>
            </div>

            <Table
                columns={columns}
                dataSource={webhooks ?? []}
                loading={isLoading}
                rowKey="id"
                bordered
                pagination={false}
                onRow={(record) => ({
                    onClick: () => handleEdit(record),
                    style: {cursor: "pointer"},
                })}
            />

            <AutomationDrawer onSuccess={handleModalSuccess} />
            <DeleteAutomationModal />
            <SecretRevealModal />
        </section>
    )
}

export default Automations

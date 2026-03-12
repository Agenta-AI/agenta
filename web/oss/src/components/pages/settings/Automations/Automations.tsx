import {useCallback, useMemo, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Lightning, PencilLineIcon, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, Tag, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import AutomationDrawer from "@/oss/components/Automations/AutomationDrawer"
import DeleteAutomationModal from "@/oss/components/Automations/Modals/DeleteAutomationModal"
import SecretRevealModal from "@/oss/components/Automations/Modals/SecretRevealModal"
import {
    AUTOMATION_TEST_FAILURE_MESSAGE,
    handleTestResult,
} from "@/oss/components/Automations/utils/handleTestResult"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import {AutomationProvider, WebhookSubscription} from "@/oss/services/automations/types"
import {automationsAtom, testAutomationAtom} from "@/oss/state/automations/atoms"
import {
    editingAutomationAtom,
    isAutomationDrawerOpenAtom,
    webhookToDeleteAtom,
} from "@/oss/state/automations/state"

const {Title} = Typography

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

    const handleDeleteClick = useCallback((webhook: WebhookSubscription) => {
        setWebhookToDelete(webhook)
    }, [])

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

    const webhooksWithKey = useMemo(() => webhooks?.map((w) => ({...w, key: w.id})), [webhooks])

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
                title: "Provider",
                key: "provider",
                width: 120,
                render: (_: any, record: WebhookSubscription) => {
                    const isGitHub = isGitHubApiUrl(record.data?.url)
                    const provider: AutomationProvider = isGitHub ? "github" : "webhook"
                    return (
                        <Tag color={isGitHub ? "default" : "blue"}>
                            {provider === "github" ? "GitHub" : "Webhook"}
                        </Tag>
                    )
                },
            },
            {
                title: "Destination",
                dataIndex: ["data", "url"],
                key: "url",
                width: 250,
                render: (url: string) => {
                    const isGitHub = isGitHubApiUrl(url)
                    let displayUrl = url
                    if (isGitHub) {
                        const repoMatch = url.match(/repos\/([^\/]+\/[^\/]+)\//)
                        if (repoMatch) {
                            displayUrl = repoMatch[1]
                        }
                    }
                    return (
                        <Tag
                            className="max-w-[250px] truncate"
                            title={url} // Show full URL on hover
                        >
                            {displayUrl}
                        </Tag>
                    )
                },
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
                title: "Status",
                key: "status",
                width: 120,
                render: (_: any, record: WebhookSubscription) => {
                    const isValid = record.flags?.is_valid === true
                    return (
                        <Tag color={isValid ? "green" : "gold"}>
                            {isValid ? "Active" : "Pending"}
                        </Tag>
                    )
                },
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
                            label: testingWebhookId === record.id ? "Testing..." : "Test",
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
                            onClick: () => handleDeleteClick(record),
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
        [handleEdit, handleDeleteClick, handleTestWebhook, testingWebhookId],
    )

    return (
        <div className="flex flex-col h-full gap-4">
            <div className="flex items-center gap-3">
                <Title level={4} className="!m-0">
                    Automations
                </Title>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
                    Create
                </Button>
            </div>

            <EnhancedTable
                columns={columns}
                dataSource={webhooksWithKey}
                loading={isLoading}
                rowKey="id"
                uniqueKey="automations-table"
                onRow={(record) => ({
                    onClick: (e) => {
                        // Don't open edit drawer when clicking the actions column
                        if (
                            (e.target as HTMLElement).closest(
                                ".ant-dropdown-trigger, .ant-dropdown",
                            )
                        )
                            return
                        handleEdit(record)
                    },
                    style: {cursor: "pointer"},
                })}
            />

            <AutomationDrawer onSuccess={handleModalSuccess} />

            <DeleteAutomationModal />

            <SecretRevealModal />
        </div>
    )
}

export default Automations

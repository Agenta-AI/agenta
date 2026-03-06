import {useCallback, useMemo, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Lightning, PencilLineIcon, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, Modal, Tag, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import AutomationDrawer from "@/oss/components/Automations/AutomationDrawer"
import {handleTestResult} from "@/oss/components/Automations/utils/handleTestResult"
import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import {AutomationProvider, WebhookSubscription} from "@/oss/services/automations/types"
import {
    automationsAtom,
    deleteAutomationAtom,
    testAutomationAtom,
} from "@/oss/state/automations/atoms"
import {editingAutomationAtom, isAutomationDrawerOpenAtom} from "@/oss/state/automations/state"

const {Title} = Typography

const Automations: React.FC = () => {
    const [{data: webhooks, isPending: isLoading}] = useAtom(automationsAtom)
    const setIsModalOpen = useSetAtom(isAutomationDrawerOpenAtom)
    const setEditingWebhook = useSetAtom(editingAutomationAtom)
    const deleteWebhook = useSetAtom(deleteAutomationAtom)
    const testWebhook = useSetAtom(testAutomationAtom)

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
                title: "Delete Automation",
                content: "Are you sure you want to delete this automation?",
                onOk: async () => {
                    try {
                        await deleteWebhook(webhook.id)
                        message.success("Automation deleted successfully")
                    } catch (error) {
                        message.error("Failed to delete automation")
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
                handleTestResult(response)
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
                title: "Provider",
                key: "provider",
                width: 120,
                render: (_: any, record: WebhookSubscription) => {
                    const isGitHub = record.data?.url?.includes("api.github.com")
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
                    const isGitHub = url.includes("api.github.com")
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
                    Automations
                </Title>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>
                    Create Automation
                </Button>
            </div>

            <EnhancedTable
                columns={columns}
                dataSource={webhooksWithKey}
                loading={isLoading}
                rowKey="id"
                uniqueKey="automations-table"
            />

            <AutomationDrawer onSuccess={handleModalSuccess} />
        </div>
    )
}

export default Automations

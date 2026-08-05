import {useCallback, useMemo, useState} from "react"

import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowClockwise, GearSix, PencilSimpleLine, Play, Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Tooltip, Typography, message} from "antd"
import {useAtom, useSetAtom} from "jotai"

import DeleteWebhookModal from "@/oss/components/Webhooks/Modals/DeleteWebhookModal"
import SecretRevealModal from "@/oss/components/Webhooks/Modals/SecretRevealModal"
import {
    WEBHOOK_TEST_FAILURE_MESSAGE,
    handleTestResult,
} from "@/oss/components/Webhooks/utils/handleTestResult"
import WebhookDrawer from "@/oss/components/Webhooks/WebhookDrawer"
import {WebhookProvider, WebhookSubscription} from "@/oss/services/webhooks/types"
import {setWebhookActiveAtom, webhooksAtom, testWebhookAtom} from "@/oss/state/webhooks/atoms"
import {
    editingWebhookAtom,
    isWebhookDrawerOpenAtom,
    webhookToDeleteAtom,
} from "@/oss/state/webhooks/state"

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

const getProviderLabel = (url?: string | null): WebhookProvider => {
    return isGitHubApiUrl(url) ? "github" : "webhook"
}

// WP6: webhooks now carry `flags.is_active`; default true when absent.
const isWebhookActive = (webhook: WebhookSubscription): boolean => {
    const raw = webhook.flags?.is_active
    return raw === undefined || raw === null ? true : Boolean(raw)
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

const Webhooks: React.FC = () => {
    const [{data: webhooks, isPending: isLoading, refetch}] = useAtom(webhooksAtom)
    const setIsDrawerOpen = useSetAtom(isWebhookDrawerOpenAtom)
    const setEditingWebhook = useSetAtom(editingWebhookAtom)
    const testWebhookSubscription = useSetAtom(testWebhookAtom)
    const setWebhookActive = useSetAtom(setWebhookActiveAtom)
    const setWebhookToDelete = useSetAtom(webhookToDeleteAtom)

    const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null)
    const [reloading, setReloading] = useState(false)

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            await refetch()
        } finally {
            setReloading(false)
        }
    }, [refetch])

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
                const response = await testWebhookSubscription({
                    subscription: {
                        id: webhook.id,
                        name: webhook.name,
                        description: webhook.description,
                        data: webhook.data,
                    },
                })
                handleTestResult(response)
            } catch (error) {
                console.error(error)
                message.error(WEBHOOK_TEST_FAILURE_MESSAGE, 10)
            } finally {
                setTestingWebhookId(null)
            }
        },
        [testWebhookSubscription],
    )

    const handleToggle = useCallback(
        (webhook: WebhookSubscription) => async (next: boolean) => {
            await setWebhookActive({id: webhook.id, active: next})
        },
        [setWebhookActive],
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
                    style: {minWidth: 100},
                }),
                render: (_: any, record: WebhookSubscription) =>
                    isWebhookActive(record) ? <Tag color="green">Active</Tag> : <Tag>Paused</Tag>,
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 96,
                fixed: "right" as const,
                align: "center" as const,
                render: (_: any, record: WebhookSubscription) => (
                    <div className="flex items-center justify-center gap-1">
                        <ActiveToggle
                            active={isWebhookActive(record)}
                            onToggle={handleToggle(record)}
                            activatedMessage="Webhook resumed"
                            pausedMessage="Webhook paused"
                            errorMessage="Failed to update webhook"
                        />
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
                                aria-label="Open webhook actions"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </Dropdown>
                    </div>
                ),
            },
        ],
        [handleDeleteClick, handleEdit, handleTestWebhook, handleToggle, testingWebhookId],
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
                    Subscribe
                </Button>
                <Tooltip title="Reload all webhooks">
                    <Button
                        icon={<ArrowClockwise size={14} />}
                        type="text"
                        size="small"
                        aria-label="Reload all webhooks"
                        loading={reloading}
                        onClick={reloadAll}
                    />
                </Tooltip>
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

            <WebhookDrawer onSuccess={handleModalSuccess} />
            <DeleteWebhookModal />
            <SecretRevealModal />
        </section>
    )
}

export default Webhooks

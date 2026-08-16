import {useCallback, useMemo, useState} from "react"

import type {WebhookProvider, WebhookSubscription} from "@agenta/entities/webhook"
import {WEBHOOK_TEST_FAILURE_MESSAGE, handleTestResult} from "@agenta/entities/webhook"
import {setWebhookActiveAtom, testWebhookAtom, webhooksAtom} from "@agenta/entities/webhook"
import {
    editingWebhookAtom,
    isWebhookDrawerOpenAtom,
    webhookToDeleteAtom,
} from "@agenta/entities/webhook"
import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {PencilSimpleLine, Play, Plus, Trash} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

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

interface WebhookRow extends WebhookSubscription {
    key: string
    [extra: string]: unknown
}

export interface WebhooksPageProps {
    /** The drawer that creates/edits a subscription — the host's. */
    renderDrawer?: (args: {onSuccess: () => void}) => React.ReactNode
    /** Delete confirmation and the one-time secret reveal — also the host's. */
    renderDeleteDialog?: () => React.ReactNode
    renderSecretReveal?: () => React.ReactNode
}

export const WebhooksPage = ({
    renderDrawer,
    renderDeleteDialog,
    renderSecretReveal,
}: WebhooksPageProps) => {
    const [{data: webhooks, isPending: isLoading, refetch}] = useAtom(webhooksAtom)
    const [searchTerm, setSearchTerm] = useState("")
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

    const rows = useMemo<WebhookRow[]>(() => {
        const all = (webhooks ?? []).map((webhook) => ({...webhook, key: webhook.id}))
        const term = searchTerm.trim().toLowerCase()
        if (!term) return all
        return all.filter((webhook) =>
            [webhook.name, webhook.data?.url].some((value) => value?.toLowerCase().includes(term)),
        )
    }, [webhooks, searchTerm])

    const columns = useMemo<DataTableColumn<WebhookRow>[]>(
        () => [
            {key: "name", title: "Name", width: 200, render: (record) => record.name || "-"},
            {
                key: "provider",
                title: "Type",
                width: 110,
                render: (record) =>
                    getProviderLabel(record.data?.url) === "github" ? "GitHub" : "Webhook",
            },
            {
                key: "url",
                title: "Target",
                width: 320,
                render: (record) => {
                    const url = record.data?.url
                    return (
                        <span className="block truncate" title={url}>
                            {formatDestination(url)}
                        </span>
                    )
                },
            },
            {
                key: "events",
                title: "Events",
                width: 220,
                render: (record) => {
                    const value = record.data?.event_types?.join(", ") || "-"
                    return (
                        <span className="block truncate" title={value}>
                            {value}
                        </span>
                    )
                },
            },
            {
                // The toggle shows the state and changes it, so it lives in Status.
                key: "status",
                title: "Status",
                width: 120,
                render: (record) => (
                    <div onClick={(event) => event.stopPropagation()}>
                        <ActiveToggle
                            active={isWebhookActive(record)}
                            onToggle={handleToggle(record)}
                            activatedMessage="Webhook resumed"
                            pausedMessage="Webhook paused"
                            errorMessage="Failed to update webhook"
                        />
                    </div>
                ),
            },
        ],
        [handleToggle],
    )

    return (
        <div className="flex flex-col gap-2">
            <DataTable<WebhookRow>
                columns={columns}
                rows={rows}
                rowKey={(record) => record.key}
                loading={isLoading}
                onRowClick={renderDrawer ? handleEdit : undefined}
                actions={(record) => [
                    {
                        key: "test",
                        label: "Test",
                        icon: <Play size={16} />,
                        disabled: testingWebhookId !== null,
                        onClick: () => handleTestWebhook(record),
                    },
                    {
                        key: "edit",
                        label: "Edit",
                        icon: <PencilSimpleLine size={16} />,
                        // The form is the host's drawer; without one this opens nothing.
                        hidden: !renderDrawer,
                        onClick: () => handleEdit(record),
                    },
                    {type: "divider"},
                    {
                        key: "delete",
                        label: "Delete",
                        icon: <Trash size={16} />,
                        danger: true,
                        hidden: !renderDeleteDialog,
                        onClick: () => handleDeleteClick(record),
                    },
                ]}
                search={{
                    placeholder: "Search webhooks",
                    value: searchTerm,
                    onChange: setSearchTerm,
                    disabled: isLoading,
                }}
                onReload={reloadAll}
                reloading={reloading}
                reloadLabel="Reload all webhooks"
                primaryActions={
                    renderDrawer ? (
                        <Button onClick={handleCreate} disabled={isLoading}>
                            <Plus size={14} />
                            Subscribe
                        </Button>
                    ) : null
                }
                empty={
                    searchTerm.trim() ? (
                        <EmptyState
                            image="simple"
                            description={`No webhooks match “${searchTerm.trim()}”`}
                        />
                    ) : (
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No webhooks yet
                                    </span>
                                    <span>
                                        Subscribe an endpoint to receive workflow events as signed
                                        HTTP requests.
                                    </span>
                                </div>
                            }
                        >
                            {renderDrawer ? (
                                <Button variant="outline" onClick={handleCreate}>
                                    <Plus size={14} />
                                    Subscribe
                                </Button>
                            ) : null}
                        </EmptyState>
                    )
                }
            />

            {renderDrawer?.({onSuccess: handleModalSuccess})}
            {renderDeleteDialog?.()}
            {renderSecretReveal?.()}
        </div>
    )
}

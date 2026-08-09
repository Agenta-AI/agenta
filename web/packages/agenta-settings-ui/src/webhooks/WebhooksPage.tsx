import {useCallback, useMemo, useState} from "react"

import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {
    InfiniteVirtualTableFeatureShell,
    createStandardColumns,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, PencilSimpleLine, Play, Plus, Trash} from "@phosphor-icons/react"
import {message} from "@agenta/ui/app-message"
import {Button, Input, Tooltip, TooltipContent, TooltipTrigger} from "@agenta/ui/ui"
import {useAtom, useSetAtom} from "jotai"

import {useStaticTable} from "@agenta/settings"
import {
    WEBHOOK_TEST_FAILURE_MESSAGE,
    handleTestResult,
} from "@agenta/entities/webhook"
import type {WebhookProvider, WebhookSubscription} from "@agenta/entities/webhook"
import {setWebhookActiveAtom, testWebhookAtom, webhooksAtom} from "@agenta/entities/webhook"
import {
    editingWebhookAtom,
    isWebhookDrawerOpenAtom,
    webhookToDeleteAtom,
} from "@agenta/entities/webhook"

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

    const columns = useMemo(
        () =>
            createStandardColumns<WebhookRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 200,
                    fixed: "left",
                    render: (_value, record) => (
                        <span>{record.name || "-"}</span>
                    ),
                },
                {
                    type: "text",
                    key: "provider",
                    title: "Type",
                    width: 110,
                    render: (_value, record) =>
                        getProviderLabel(record.data?.url) === "github" ? "GitHub" : "Webhook",
                },
                {
                    type: "text",
                    key: "url",
                    title: "Target",
                    width: 320,
                    render: (_value, record) => {
                        const url = record.data?.url
                        return (
                            <span className="block truncate" title={url}>
                                {formatDestination(url)}
                            </span>
                        )
                    },
                },
                {
                    type: "text",
                    key: "events",
                    title: "Events",
                    width: 220,
                    render: (_value, record) => {
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
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 120,
                    render: (_value, record) => (
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
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "test",
                            label: "Test",
                            icon: <Play size={16} />,
                            disabled: () => testingWebhookId !== null,
                            onClick: (record: WebhookRow) => handleTestWebhook(record),
                        },
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: WebhookRow) => handleEdit(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: WebhookRow) => handleDeleteClick(record),
                        },
                    ],
                } satisfies StandardColumnDef<WebhookRow>,
            ]),
        [handleDeleteClick, handleEdit, handleTestWebhook, handleToggle, testingWebhookId],
    )

    const {tableScope, pagination} = useStaticTable<WebhookRow>("settings-webhooks", rows, {
        loading: isLoading,
    })
    return (
        <div className="flex flex-col gap-2">
            <InfiniteVirtualTableFeatureShell<WebhookRow>
                tableScope={tableScope}
                autoHeight={false}
                columns={columns}
                rowKey="key"
                pagination={pagination}
                filters={
                    <Input
                        placeholder="Search webhooks"
                        className="w-[260px]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        disabled={isLoading}
                    />
                }
                primaryActions={
                    <>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    aria-label="Reload all webhooks"
                                    disabled={reloading}
                                    onClick={reloadAll}
                                >
                                    <ArrowClockwise size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reload all webhooks</TooltipContent>
                        </Tooltip>
                        <Button onClick={handleCreate} disabled={isLoading}>
                            <Plus size={14} />
                            Subscribe
                        </Button>
                    </>
                }
                tableProps={{
                    size: "small",
                    bordered: true,
                    tableLayout: "fixed",
                    locale: {
                        emptyText: searchTerm.trim() ? (
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
                                            Subscribe an endpoint to receive workflow events as
                                            signed HTTP requests.
                                        </span>
                                    </div>
                                }
                            >
                                <Button variant="outline" onClick={handleCreate}>
                                    <Plus size={14} />
                                    Subscribe
                                </Button>
                            </EmptyState>
                        ),
                    },
                    onRow: (record: WebhookRow) => ({
                        onClick: () => handleEdit(record),
                        className: "cursor-pointer",
                    }),
                }}
            />

            {renderDrawer?.({onSuccess: handleModalSuccess})}
            {renderDeleteDialog?.()}
            {renderSecretReveal?.()}
        </div>
    )
}

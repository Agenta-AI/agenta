import {useCallback, useMemo, useState} from "react"

import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {
    ArrowClockwise,
    DotsThree,
    GearSix,
    PencilSimpleLine,
    Play,
    Plus,
    Trash,
} from "@phosphor-icons/react"
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
                toast.error(WEBHOOK_TEST_FAILURE_MESSAGE, {duration: 10_000})
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

    const columns: ColumnDef<WebhookSubscription, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                accessorKey: "name",
                header: "Name",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name || "-"}</span>,
            },
            {
                id: "provider",
                header: "Type",
                minSize: 100,
                enableSorting: false,
                cell: ({row}) => {
                    const provider = getProviderLabel(row.original.data?.url)
                    return <span>{provider === "github" ? "GitHub" : "Webhook"}</span>
                },
            },
            {
                id: "url",
                header: "Target",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => {
                    const url = row.original.data?.url
                    return (
                        <span className="inline-block max-w-[320px] truncate" title={url}>
                            {formatDestination(url)}
                        </span>
                    )
                },
            },
            {
                id: "events",
                header: "Events",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => {
                    const value = row.original.data?.event_types?.join(", ") || "-"
                    return (
                        <span className="inline-block max-w-[260px] truncate" title={value}>
                            {value}
                        </span>
                    )
                },
            },
            {
                id: "status",
                header: "Status",
                minSize: 100,
                enableSorting: false,
                cell: ({row}) =>
                    isWebhookActive(row.original) ? (
                        <Badge>Active</Badge>
                    ) : (
                        <Badge variant="secondary">Paused</Badge>
                    ),
            },
            {
                id: "actions",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 96,
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex items-center justify-center gap-1">
                            <ActiveToggle
                                active={isWebhookActive(record)}
                                onToggle={handleToggle(record)}
                                activatedMessage="Webhook resumed"
                                pausedMessage="Webhook paused"
                                errorMessage="Failed to update webhook"
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Open webhook actions"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {testingWebhookId === record.id ? (
                                                <Spinner />
                                            ) : (
                                                <DotsThree size={16} />
                                            )}
                                        </Button>
                                    }
                                />
                                <DropdownMenuContent className="w-[180px]" align="end">
                                    <DropdownMenuItem
                                        disabled={testingWebhookId !== null}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleTestWebhook(record)
                                        }}
                                    >
                                        <Play size={16} />
                                        Test
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleEdit(record)
                                        }}
                                    >
                                        <PencilSimpleLine size={16} />
                                        Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDeleteClick(record)
                                        }}
                                    >
                                        <Trash size={16} />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )
                },
            },
        ],
        [handleDeleteClick, handleEdit, handleTestWebhook, handleToggle, testingWebhookId],
    )

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleCreate}>
                    <Plus size={14} />
                    Subscribe
                </Button>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Reload all webhooks"
                                disabled={reloading}
                                onClick={reloadAll}
                            >
                                {reloading ? <Spinner /> : <ArrowClockwise size={14} />}
                            </Button>
                        }
                    />
                    <TooltipContent>Reload all webhooks</TooltipContent>
                </Tooltip>
            </div>

            <DataTable<WebhookSubscription>
                columns={columns}
                data={webhooks ?? []}
                loading={isLoading}
                getRowId={(record) => record.id}
                enableSorting={false}
                onRowClick={(row) => handleEdit(row.original)}
            />

            <WebhookDrawer onSuccess={handleModalSuccess} />
            <DeleteWebhookModal />
            <SecretRevealModal />
        </section>
    )
}

export default Webhooks

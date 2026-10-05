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
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, IconTile} from "@agenta/ui/ui"
import {GithubLogo, PencilSimpleLine, Play, Plus, Trash, WebhooksLogo} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

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
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(200px,2fr)"},
    {key: "url", label: "Target", width: "minmax(180px,2fr)"},
    {key: "events", label: "Events", width: "minmax(140px,1.4fr)"},
    {key: "status", label: "Status", width: "minmax(96px,0.8fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]

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
    const [{data: webhooks, isPending: isLoading}] = useAtom(webhooksAtom)
    const setIsDrawerOpen = useSetAtom(isWebhookDrawerOpenAtom)
    const setEditingWebhook = useSetAtom(editingWebhookAtom)
    const testWebhookSubscription = useSetAtom(testWebhookAtom)
    const setWebhookActive = useSetAtom(setWebhookActiveAtom)
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
        return (webhooks ?? []).map((webhook) => ({...webhook, key: webhook.id}))
    }, [webhooks])

    const subscribe = renderDrawer ? (
        <Button onClick={handleCreate} disabled={isLoading}>
            <Plus size={14} />
            Subscribe
        </Button>
    ) : null

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{subscribe}</SettingsPageActions>
            <ListTable<WebhookRow>
                columns={COLUMNS}
                groups={[{key: "webhooks", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={640}
                loading={isLoading}
                hideHeader={!isLoading && rows.length === 0}
                onOpenRow={renderDrawer ? handleEdit : undefined}
                empty={
                    <SettingsEmpty
                        icon={<WebhooksLogo size={18} />}
                        title="No webhooks yet"
                        description="Subscribe an endpoint to receive workflow events as signed HTTP requests."
                        action={subscribe}
                    />
                }
                renderRow={(record) => {
                    const url = record.data?.url
                    const events = record.data?.event_types?.join(", ") || "-"
                    const github = getProviderLabel(url) === "github"
                    return (
                        <>
                            <span className="flex min-w-0 items-center gap-2.5">
                                <IconTile
                                    size={28}
                                    tone="muted"
                                    aria-hidden="true"
                                    className="border border-solid border-border bg-muted text-muted-foreground"
                                >
                                    {github ? <GithubLogo /> : <WebhooksLogo />}
                                </IconTile>
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium">
                                        {record.name || "-"}
                                    </span>
                                    <span className="truncate text-[12.5px] text-muted-foreground">
                                        {github ? "GitHub" : "Webhook"}
                                    </span>
                                </span>
                            </span>
                            <span className="truncate text-muted-foreground" title={url}>
                                {formatDestination(url)}
                            </span>
                            <span className="truncate text-muted-foreground" title={events}>
                                {events}
                            </span>
                            {/* The toggle shows the state and changes it, so it lives in Status. */}
                            <div onClick={(event) => event.stopPropagation()}>
                                <ActiveToggle
                                    active={isWebhookActive(record)}
                                    onToggle={handleToggle(record)}
                                    activatedMessage="Webhook resumed"
                                    pausedMessage="Webhook paused"
                                    errorMessage="Failed to update webhook"
                                />
                            </div>
                            <SettingsRowMenu
                                label="Webhook actions"
                                items={[
                                    {
                                        key: "test",
                                        label: "Test",
                                        icon: <Play size={14} />,
                                        disabled: testingWebhookId !== null,
                                        onClick: () => handleTestWebhook(record),
                                    },
                                    {
                                        key: "edit",
                                        label: "Edit",
                                        icon: <PencilSimpleLine size={14} />,
                                        // The form is the host's drawer; without one this opens nothing.
                                        hidden: !renderDrawer,
                                        onClick: () => handleEdit(record),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !renderDeleteDialog,
                                        onClick: () => handleDeleteClick(record),
                                    },
                                ]}
                            />
                        </>
                    )
                }}
            />

            {renderDrawer?.({onSuccess: handleModalSuccess})}
            {renderDeleteDialog?.()}
            {renderSecretReveal?.()}
        </section>
    )
}

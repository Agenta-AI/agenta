import {useCallback, useState} from "react"

import {
    connectionDrawerAtom,
    isConnectionActive,
    isConnectionValid,
    toolExecutionDrawerAtom,
    useToolConnectionActions,
    useToolConnectionQuery,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {getAgentaApiUrl, getAgentaWebUrl, queryClient} from "@agenta/shared/api"
import {dayjs} from "@agenta/shared/utils"
import {useConfirmDialog} from "@agenta/ui/components/modal"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowClockwise, Play, Trash, XCircle} from "@phosphor-icons/react"
import {Descriptions, Divider, Spin} from "antd"
import {useAtom, useSetAtom} from "jotai"

import ConnectionStatusBadge from "../components/ConnectionStatusBadge"

function formatCreatedAt(value: string | null | undefined): string {
    if (!value) return "-"
    const parsed = dayjs.utc(value)
    return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : "-"
}

export default function ConnectionManagerDrawer() {
    const {confirm, confirmDialog} = useConfirmDialog()
    const [state, setState] = useAtom(connectionDrawerAtom)
    const setExecution = useSetAtom(toolExecutionDrawerAtom)
    const open = !!state
    const {handleDelete, handleRefresh, handleRevoke} = useToolConnectionActions()
    const connectionId = state?.connectionId
    const {connection, isLoading, refetch} = useToolConnectionQuery(connectionId)

    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const handleClose = useCallback(() => {
        setState(null)
    }, [setState])

    const setConnectionInCache = useCallback(
        (nextConnection: ToolConnection | null) => {
            if (!connectionId) return
            queryClient.setQueryData(["tools", "connections", connectionId], {
                count: nextConnection ? 1 : 0,
                connection: nextConnection,
            })
        },
        [connectionId],
    )

    const onRefresh = useCallback(async () => {
        if (!state?.connectionId) return
        setActionLoading("refresh")
        try {
            const result = await handleRefresh(state.connectionId)
            const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                ?.redirect_url

            if (typeof redirectUrl === "string" && redirectUrl) {
                const popup = window.open(
                    redirectUrl,
                    "tools_oauth_refresh",
                    "width=600,height=700,popup=yes",
                )

                if (!popup) {
                    setConnectionInCache(result.connection ?? null)
                    return
                }

                const syncConnection = async () => {
                    window.focus()
                    try {
                        await refetch()
                    } catch {
                        setConnectionInCache(result.connection ?? null)
                    }
                }

                const trustedOrigins = new Set<string>([window.location.origin])
                for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                    if (!url) continue
                    try {
                        trustedOrigins.add(new URL(url).origin)
                    } catch {
                        // ignore invalid env URLs
                    }
                }

                const handler = (event: MessageEvent) => {
                    if (
                        event.data?.type === "tools:oauth:complete" &&
                        trustedOrigins.has(event.origin)
                    ) {
                        window.removeEventListener("message", handler)
                        void syncConnection()
                    }
                }
                window.addEventListener("message", handler)

                const pollTimer = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(pollTimer)
                        window.removeEventListener("message", handler)
                        void syncConnection()
                    }
                }, 1000)
            } else {
                setConnectionInCache(result.connection ?? null)
            }
        } finally {
            setActionLoading(null)
        }
    }, [state?.connectionId, handleRefresh, refetch, setConnectionInCache])

    const onRevoke = useCallback(() => {
        if (!state?.connectionId) return
        confirm({
            title: "Revoke Connection",
            content:
                "This will mark the connection as invalid. You can refresh it later to reactivate.",
            okText: "Yes",
            cancelText: "Cancel",
            onOk: async () => {
                setActionLoading("revoke")
                try {
                    const result = await handleRevoke(state.connectionId)
                    setConnectionInCache(result.connection ?? null)
                } finally {
                    setActionLoading(null)
                }
            },
        })
    }, [confirm, state?.connectionId, handleRevoke, setConnectionInCache])

    const onDelete = useCallback(() => {
        if (!state?.connectionId) return
        confirm({
            title: "Delete Connection",
            content:
                "Are you sure you want to delete this connection? This action is irreversible.",
            okText: "Yes",
            cancelText: "Cancel",
            onOk: async () => {
                setActionLoading("delete")
                try {
                    await handleDelete(state.connectionId)
                    handleClose()
                } finally {
                    setActionLoading(null)
                }
            },
        })
    }, [confirm, state?.connectionId, handleDelete, handleClose])

    const onTest = useCallback(() => {
        if (!connection?.id || !connection.slug) return
        setExecution({
            connectionId: connection.id,
            connectionSlug: connection.slug,
            integrationKey: connection.integration_key,
        })
    }, [connection, setExecution])

    const isActive = isConnectionActive(connection)
    const isValid = isConnectionValid(connection)

    return (
        <EnhancedDrawer
            open={open}
            onClose={handleClose}
            title="Connection Details"
            width={480}
            destroyOnClose
        >
            {confirmDialog}
            <div className="flex flex-col gap-4">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin />
                    </div>
                ) : !connection ? (
                    <span className="text-muted-foreground">Connection not found.</span>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1">
                                <h5 className="!mb-0 text-sm font-semibold leading-normal">
                                    {connection.name || connection.slug}
                                </h5>
                                <span className="text-xs text-muted-foreground">
                                    {connection.integration_key}
                                </span>
                            </div>
                            <ConnectionStatusBadge connection={connection} />
                        </div>

                        {/* Details */}
                        <Descriptions
                            column={1}
                            size="small"
                            bordered
                            items={[
                                {
                                    key: "slug",
                                    label: "Slug",
                                    children: connection.slug,
                                },
                                {
                                    key: "provider",
                                    label: "Provider",
                                    children: connection.provider_key,
                                },
                                {
                                    key: "integration",
                                    label: "Integration",
                                    children: connection.integration_key,
                                },
                                {
                                    key: "active",
                                    label: "Active",
                                    children: isActive ? "Yes" : "No",
                                },
                                {
                                    key: "valid",
                                    label: "Authenticated",
                                    children: isValid ? "Yes" : "No",
                                },
                                {
                                    key: "created",
                                    label: "Created",
                                    children: formatCreatedAt(connection.created_at),
                                },
                            ]}
                        />

                        <Divider className="my-1" />

                        {/* Actions */}
                        <span className="text-sm font-semibold">Actions</span>
                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={onTest}
                                disabled={!isActive || !isValid}
                                variant="outline"
                            >
                                {<Play size={14} />}
                                Test Connection
                            </Button>
                            <Button
                                onClick={onRefresh}
                                variant="outline"
                                disabled={actionLoading === "refresh"}
                            >
                                {actionLoading === "refresh" ? <Spinner /> : null}
                                {<ArrowClockwise size={14} />}
                                Refresh Connection
                            </Button>
                            <Button
                                onClick={onRevoke}
                                disabled={!isValid || actionLoading === "revoke"}
                                variant="outline"
                            >
                                {actionLoading === "revoke" ? <Spinner /> : null}
                                {<XCircle size={14} />}
                                Revoke Connection
                            </Button>
                            <Button
                                onClick={onDelete}
                                variant="destructive"
                                disabled={actionLoading === "delete"}
                            >
                                {actionLoading === "delete" ? <Spinner /> : null}
                                {<Trash size={14} />}
                                Delete Connection
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </EnhancedDrawer>
    )
}

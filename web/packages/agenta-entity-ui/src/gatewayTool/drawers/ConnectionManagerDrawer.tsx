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
import {getAgentaApiUrl, getAgentaWebUrl, getHostQueryClient} from "@agenta/shared/api"
import {dayjs} from "@agenta/shared/utils"
import {modal} from "@agenta/ui/app-message"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Divider, LoadingButton, Spinner} from "@agenta/ui/ui"
import {ArrowClockwise, Play, Trash, XCircle} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

import ConnectionStatusBadge from "../components/ConnectionStatusBadge"

function formatCreatedAt(value: string | null | undefined): string {
    if (!value) return "-"
    const parsed = dayjs.utc(value)
    return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : "-"
}

/** antd `Descriptions bordered size="small"` replacement — a 2-col bordered detail table. */
function DetailsTable({items}: {items: {key: string; label: string; children: React.ReactNode}[]}) {
    return (
        <div className="box-border overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
            {items.map((item, i) => (
                <div
                    key={item.key}
                    className={`grid grid-cols-[120px_1fr] text-xs ${
                        i > 0 ? "border-0 border-t border-solid border-colorBorderSecondary" : ""
                    }`}
                >
                    <div className="border-0 border-r border-solid border-colorBorderSecondary bg-colorFillQuaternary px-3 py-2 text-colorTextDescription">
                        {item.label}
                    </div>
                    <div className="px-3 py-2 break-all">{item.children}</div>
                </div>
            ))}
        </div>
    )
}

export default function ConnectionManagerDrawer() {
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
            getHostQueryClient().setQueryData(["tools", "connections", connectionId], {
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
        modal.confirm({
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
    }, [state?.connectionId, handleRevoke, setConnectionInCache])

    const onDelete = useCallback(() => {
        if (!state?.connectionId) return
        modal.confirm({
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
    }, [state?.connectionId, handleDelete, handleClose])

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
            <div className="flex flex-col gap-4">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spinner />
                    </div>
                ) : !connection ? (
                    <span className="text-colorTextDescription">Connection not found.</span>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1">
                                <div className="text-base font-semibold text-colorTextHeading">
                                    {connection.name || connection.slug}
                                </div>
                                <span className="text-xs text-colorTextDescription">
                                    {connection.integration_key}
                                </span>
                            </div>
                            <ConnectionStatusBadge connection={connection} />
                        </div>

                        {/* Details */}
                        <DetailsTable
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
                        <span className="text-sm font-medium">Actions</span>
                        <div className="flex flex-col gap-2">
                            <LoadingButton
                                variant="outline"
                                onClick={onTest}
                                disabled={!isActive || !isValid}
                            >
                                <Play size={14} />
                                Test Connection
                            </LoadingButton>
                            <LoadingButton
                                variant="outline"
                                loading={actionLoading === "refresh"}
                                onClick={onRefresh}
                            >
                                <ArrowClockwise size={14} />
                                Refresh Connection
                            </LoadingButton>
                            <LoadingButton
                                variant="outline"
                                loading={actionLoading === "revoke"}
                                onClick={onRevoke}
                                disabled={!isValid}
                            >
                                <XCircle size={14} />
                                Revoke Connection
                            </LoadingButton>
                            <LoadingButton
                                variant="destructive-outline"
                                loading={actionLoading === "delete"}
                                onClick={onDelete}
                            >
                                <Trash size={14} />
                                Delete Connection
                            </LoadingButton>
                        </div>
                    </>
                )}
            </div>
        </EnhancedDrawer>
    )
}

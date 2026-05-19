import {useCallback, useState} from "react"

import {
    connectionDrawerAtom,
    executionDrawerAtom,
    isConnectionActive,
    isConnectionValid,
    useConnectionActions,
    useConnectionQuery,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl, queryClient} from "@agenta/shared/api"
import {dayjs} from "@agenta/shared/utils"
import {modal} from "@agenta/ui/app-message"
import {ArrowClockwise, Play, Trash, XCircle} from "@phosphor-icons/react"
import {Button, Descriptions, Divider, Drawer, Spin, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"

import ConnectionStatusBadge from "../components/ConnectionStatusBadge"

function formatCreatedAt(value: string | null | undefined): string {
    if (!value) return "-"
    const parsed = dayjs.utc(value)
    return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : "-"
}

export default function ConnectionManagerDrawer() {
    const [state, setState] = useAtom(connectionDrawerAtom)
    const setExecution = useSetAtom(executionDrawerAtom)
    const open = !!state
    const {handleDelete, handleRefresh, handleRevoke} = useConnectionActions()
    const connectionId = state?.connectionId
    const {connection, isLoading, refetch} = useConnectionQuery(connectionId)

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
        <Drawer
            open={open}
            onClose={handleClose}
            title="Connection Details"
            width={480}
            destroyOnClose
        >
            <div className="flex flex-col gap-4">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin />
                    </div>
                ) : !connection ? (
                    <Typography.Text type="secondary">Connection not found.</Typography.Text>
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="flex-1">
                                <Typography.Title level={5} className="!mb-0">
                                    {connection.name || connection.slug}
                                </Typography.Title>
                                <Typography.Text type="secondary" className="text-xs">
                                    {connection.integration_key}
                                </Typography.Text>
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
                        <Typography.Text strong className="text-sm">
                            Actions
                        </Typography.Text>
                        <div className="flex flex-col gap-2">
                            <Button
                                icon={<Play size={14} />}
                                onClick={onTest}
                                disabled={!isActive || !isValid}
                            >
                                Test Connection
                            </Button>
                            <Button
                                icon={<ArrowClockwise size={14} />}
                                loading={actionLoading === "refresh"}
                                onClick={onRefresh}
                            >
                                Refresh Connection
                            </Button>
                            <Button
                                icon={<XCircle size={14} />}
                                loading={actionLoading === "revoke"}
                                onClick={onRevoke}
                                disabled={!isValid}
                            >
                                Revoke Connection
                            </Button>
                            <Button
                                danger
                                icon={<Trash size={14} />}
                                loading={actionLoading === "delete"}
                                onClick={onDelete}
                            >
                                Delete Connection
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </Drawer>
    )
}

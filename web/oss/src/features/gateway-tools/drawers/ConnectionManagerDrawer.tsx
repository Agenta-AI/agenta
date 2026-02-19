import {useCallback, useEffect, useState} from "react"

import {ArrowsClockwise, Play, Trash, XCircle} from "@phosphor-icons/react"
import {Button, Descriptions, Divider, Drawer, Spin, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import ConnectionStatusBadge from "@/oss/components/pages/settings/Tools/components/ConnectionStatusBadge"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {fetchConnection} from "@/oss/services/tools/api"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

import {useConnectionActions} from "../hooks/useConnectionActions"
import {connectionDrawerAtom, executionDrawerAtom} from "../state/atoms"

export default function ConnectionManagerDrawer() {
    const [state, setState] = useAtom(connectionDrawerAtom)
    const setExecution = useSetAtom(executionDrawerAtom)
    const open = !!state
    const {handleDelete, handleRefresh, handleRevoke} = useConnectionActions()

    const [connection, setConnection] = useState<ConnectionItem | null>(null)
    const [loading, setLoading] = useState(false)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // Load connection details when drawer opens
    useEffect(() => {
        if (!state?.connectionId) return
        let cancelled = false
        setLoading(true)
        fetchConnection(state.connectionId)
            .then((result) => {
                if (!cancelled) setConnection(result.connection ?? null)
            })
            .catch(() => {
                if (!cancelled) setConnection(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [state?.connectionId])

    const handleClose = useCallback(() => {
        setState(null)
        setConnection(null)
    }, [setState])

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
                    setConnection(result.connection ?? null)
                    return
                }

                const syncConnection = async () => {
                    window.focus()
                    try {
                        const latest = await fetchConnection(state.connectionId)
                        setConnection(latest.connection ?? null)
                    } catch {
                        setConnection(result.connection ?? null)
                    }
                }

                const handler = (event: MessageEvent) => {
                    if (event.data?.type === "tools:oauth:complete") {
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
                setConnection(result.connection ?? null)
            }
        } finally {
            setActionLoading(null)
        }
    }, [state?.connectionId, handleRefresh])

    const onRevoke = useCallback(() => {
        if (!state?.connectionId) return
        AlertPopup({
            title: "Revoke Connection",
            message:
                "This will mark the connection as invalid. You can refresh it later to reactivate.",
            onOk: async () => {
                setActionLoading("revoke")
                try {
                    const result = await handleRevoke(state.connectionId)
                    setConnection(result.connection ?? null)
                } finally {
                    setActionLoading(null)
                }
            },
        })
    }, [state?.connectionId, handleRevoke])

    const onDelete = useCallback(() => {
        if (!state?.connectionId) return
        AlertPopup({
            title: "Delete Connection",
            message:
                "Are you sure you want to delete this connection? This action is irreversible.",
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
        if (!connection) return
        setExecution({
            connectionId: connection.id,
            connectionSlug: connection.slug,
            integrationKey: connection.integration_key,
        })
    }, [connection, setExecution])

    const isActive = connection?.flags?.is_active ?? false
    const isValid = connection?.flags?.is_valid ?? false

    return (
        <Drawer
            open={open}
            onClose={handleClose}
            title="Connection Details"
            width={480}
            destroyOnClose
        >
            <div className="flex flex-col gap-4">
                {loading ? (
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
                                    children: connection.created_at
                                        ? formatDay({
                                              date: connection.created_at,
                                              outputFormat: "YYYY-MM-DD HH:mm",
                                          })
                                        : "-",
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
                                icon={<ArrowsClockwise size={14} />}
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

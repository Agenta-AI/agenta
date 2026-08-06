import {useCallback, useEffect, useMemo, useState} from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, Plus, Trash} from "@phosphor-icons/react"
import {Alert, Button, Tooltip} from "antd"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {useLoading} from "@/oss/hooks/useLoading"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {APIKey} from "@/oss/lib/Types"
import {createApiKey, deleteApiKey, fetchAllListApiKeys} from "@/oss/services/apiKeys/api"
import {useOrgData} from "@/oss/state/org"

import {Loading} from "./assets/constants"

/** The virtual table keys rows off `key` and reads arbitrary fields, hence the index signature. */
interface APIKeyRow extends APIKey {
    key: string
    id: string
    [extra: string]: unknown
}

const formatDate = (value?: string | null) =>
    value ? new Date(value).toLocaleDateString() : undefined

const APIKeys: React.FC = () => {
    const [keys, setKeys] = useState<APIKeyRow[]>([])
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [loading, setLoading] = useLoading(Object.values(Loading))
    const {canEditApiKeys, canViewApiKeys} = useProjectPermissions()

    const {selectedOrg} = useOrgData()
    const workspaceId: string = selectedOrg?.default_workspace?.id || ""

    const listKeys = useCallback(() => {
        if (!canViewApiKeys || !workspaceId.trim()) {
            setKeys([])
            return
        }

        setLoading(Loading.LIST, true)
        fetchAllListApiKeys(workspaceId)
            .then((res) => {
                setKeys(
                    (res.data as APIKey[]).map((key) => ({
                        ...key,
                        key: key.prefix,
                        id: key.prefix,
                    })),
                )
            })
            .catch(console.error)
            .finally(() => {
                setLoading(Loading.LIST, false)
            })
    }, [canViewApiKeys, setLoading, workspaceId])

    const deleteKey = useCallback(
        (prefix: string) => {
            if (!canEditApiKeys) return

            AlertPopup({
                title: "Delete API Key",
                message:
                    "Are you sure you want to delete this API Key? This action is irreversible!",
                onOk: async () => {
                    setLoading(Loading.DELETE, true)
                    await deleteApiKey(prefix)
                        .then(() => {
                            setKeys((current) => current.filter((key) => key.prefix !== prefix))
                        })
                        .catch(console.error)
                        .finally(() => {
                            setLoading(Loading.DELETE, false)
                        })
                },
            })
        },
        [canEditApiKeys, setLoading],
    )

    const createKey = useCallback(() => {
        if (!canEditApiKeys) return

        if (!workspaceId.trim()) {
            setIsModalVisible(true)
            return
        }

        setLoading(Loading.CREATE, true)
        createApiKey(workspaceId)
            .then(({data}) => {
                listKeys()
                AlertPopup({
                    width: 520,
                    type: "success",
                    title: "API key created",
                    message: (
                        <div className="flex flex-col gap-3">
                            <div>
                                Copy this key now — it is shown once and cannot be retrieved again.
                            </div>
                            <div className="rounded-md border border-solid border-colorBorder bg-colorFillQuaternary px-3 py-2 font-mono text-xs break-all">
                                {data}
                            </div>
                        </div>
                    ),
                    cancelText: null,
                    okText: "Copy & close",
                    // The key is unrecoverable once dismissed, so OK copies it.
                    onOk: () => copyToClipboard(data),
                })
            })
            .catch(console.error)
            .finally(() => {
                setLoading(Loading.CREATE, false)
            })
    }, [canEditApiKeys, listKeys, setLoading, workspaceId])

    useEffect(() => {
        if (!canViewApiKeys) {
            setKeys([])
            return
        }

        listKeys()
    }, [canViewApiKeys, listKeys])

    const rows = keys

    const columns = useMemo(
        () =>
            createStandardColumns<APIKeyRow>([
                {
                    type: "mono",
                    key: "prefix",
                    title: "API key",
                    width: 360,
                    fixed: "left",
                    getValue: (record) => record.prefix.padEnd(40, "•"),
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Created",
                    width: 150,
                    render: (_value, record) => formatDate(record.created_at) ?? "—",
                },
                {
                    type: "text",
                    key: "expiration_date",
                    title: "Expires",
                    width: 150,
                    render: (_value, record) => {
                        const date = record.expiration_date
                            ? new Date(record.expiration_date)
                            : null
                        if (!date) return "Never"
                        return date < new Date() ? (
                            <StatusIndicator tone="error" label="Expired" />
                        ) : (
                            date.toLocaleDateString()
                        )
                    },
                },
                {
                    type: "text",
                    key: "last_used_at",
                    title: "Last used",
                    width: 190,
                    render: (_value, record) =>
                        record.last_used_at
                            ? new Date(record.last_used_at).toLocaleString()
                            : "Never used",
                },
                ...(canEditApiKeys
                    ? [
                          {
                              type: "actions",
                              showCopyId: false,
                              items: [
                                  {
                                      key: "delete",
                                      label: "Delete key",
                                      icon: <Trash size={16} />,
                                      danger: true,
                                      onClick: (record: APIKeyRow) => deleteKey(record.prefix),
                                  },
                              ],
                          } satisfies StandardColumnDef<APIKeyRow>,
                      ]
                    : []),
            ]),
        [canEditApiKeys, deleteKey],
    )

    const {tableScope, pagination} = useStaticTable<APIKeyRow>("settings-api-keys", rows)
    if (!canViewApiKeys) {
        return (
            <Alert
                type="warning"
                showIcon
                message="You do not have access to API Keys in this project."
            />
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <InfiniteVirtualTableFeatureShell<APIKeyRow>
                tableScope={tableScope}
                autoHeight={false}
                columns={columns}
                rowKey={(record) => record.prefix}
                pagination={pagination}
                primaryActions={
                    canEditApiKeys ? (
                        <>
                            <Tooltip title="Reload API keys">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload API keys"
                                    loading={loading[Loading.LIST]}
                                    onClick={listKeys}
                                />
                            </Tooltip>
                            <Button
                                type="primary"
                                loading={loading[Loading.CREATE]}
                                icon={<Plus size={14} />}
                                onClick={createKey}
                            >
                                Generate key
                            </Button>
                        </>
                    ) : null
                }
                tableProps={{
                    size: "small",
                    bordered: true,
                    tableLayout: "fixed",
                    loading: loading[Loading.LIST],
                    locale: {
                        emptyText: (
                            <EmptyState
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-base font-semibold text-colorText">
                                            No API keys yet
                                        </span>
                                        <span>
                                            Generate a key to authenticate requests to the Agenta
                                            API from your code, CI jobs, and SDKs.
                                        </span>
                                    </div>
                                }
                            >
                                {canEditApiKeys ? (
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={createKey}
                                        loading={loading[Loading.CREATE]}
                                    >
                                        Generate key
                                    </Button>
                                ) : null}
                            </EmptyState>
                        ),
                    },
                }}
            />

            <EnhancedModal
                title="Workspace ID required"
                open={isModalVisible}
                onOk={() => setIsModalVisible(false)}
                onCancel={() => setIsModalVisible(false)}
            >
                <p>Please provide a valid Workspace ID to proceed with creating an API key.</p>
            </EnhancedModal>
        </div>
    )
}

export default APIKeys

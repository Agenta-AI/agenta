import {useCallback, useEffect, useMemo, useState} from "react"

import {CopyOutlined, DeleteOutlined} from "@ant-design/icons"
import {Plus} from "@phosphor-icons/react"
import {Alert, Button, Modal, Table, Tooltip, Typography, theme} from "antd"
import {ColumnsType} from "antd/es/table"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useLoading} from "@/oss/hooks/useLoading"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {APIKey} from "@/oss/lib/Types"
import {createApiKey, deleteApiKey, fetchAllListApiKeys} from "@/oss/services/apiKeys/api"
import {useOrgData} from "@/oss/state/org"

import {Loading} from "./assets/constants"

const {Text} = Typography
const monospaceFontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, Monaco, monospace"
const monospaceKeyStyle = {
    fontFamily: monospaceFontFamily,
    letterSpacing: "0.08em",
    fontVariantLigatures: "none",
} as const

const APIKeys: React.FC = () => {
    const [keys, setKeys] = useState<APIKey[]>([])
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [loading, setLoading] = useLoading(Object.values(Loading))
    const {token} = theme.useToken()
    const {canEditApiKeys, canViewApiKeys} = useProjectPermissions()

    const {selectedOrg} = useOrgData()
    const workspaceId: string = selectedOrg?.default_workspace?.id || ""

    const listKeys = useCallback(() => {
        if (!canViewApiKeys) {
            setKeys([])
            return
        }

        if (!workspaceId || workspaceId.trim() === "") {
            setKeys([])
            return
        }

        setLoading(Loading.LIST, true)
        fetchAllListApiKeys(workspaceId)
            .then((res) => {
                setKeys(res.data)
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
                            setKeys((keys) => keys.filter((key) => key.prefix !== prefix))
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

        setLoading(Loading.CREATE, true)
        if (!workspaceId || workspaceId.trim() === "") {
            setLoading(Loading.CREATE, false)
            setIsModalVisible(true)
        } else {
            createApiKey(workspaceId)
                .then(({data}) => {
                    listKeys()
                    AlertPopup({
                        width: 650,
                        type: "success",
                        title: "API Key created",
                        message: (
                            <div>
                                <div>
                                    Make sure to copy your API Key now. You won’t be able to see it
                                    again!
                                </div>
                                <div className="mt-[0.5rem] flex items-center gap-2">
                                    <span
                                        style={{
                                            ...monospaceKeyStyle,
                                            color: token.colorTextSecondary,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {data}
                                    </span>
                                    <span>
                                        <Tooltip title="Copy">
                                            <CopyOutlined
                                                onClick={() => copyToClipboard(data)}
                                                style={{color: token.colorPrimary}}
                                            />
                                        </Tooltip>
                                    </span>
                                </div>
                            </div>
                        ),
                        cancelText: null,
                        okText: "Done",
                    })
                })
                .catch(console.error)
                .finally(() => {
                    setLoading(Loading.CREATE, false)
                })
        }
    }, [canEditApiKeys, listKeys, setLoading, token.colorPrimary, workspaceId])

    useEffect(() => {
        if (!canViewApiKeys) {
            setKeys([])
            return
        }

        listKeys()
    }, [canViewApiKeys, listKeys])

    const columns = useMemo<ColumnsType<APIKey>>(() => {
        const baseColumns: ColumnsType<APIKey> = [
            {
                title: "API Key",
                dataIndex: "prefix",
                key: "prefix",
                width: 400,
                render: (value: string) => (
                    <span
                        style={monospaceKeyStyle}
                        className="inline-block rounded border border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-[inherit] leading-none"
                    >
                        {value.padEnd(40, "*")}
                    </span>
                ),
            },
            {
                title: "Created",
                dataIndex: "created_at",
                key: "created_at",
                render: (value: string) => new Date(value).toLocaleDateString(),
            },
            {
                title: "Expires",
                dataIndex: "expiration_date",
                key: "expiration_date",
                render: (value: string) => {
                    const date = value ? new Date(value) : null
                    const hasExpired = date ? date < new Date() : false
                    return (
                        <Text type={hasExpired ? "danger" : undefined}>
                            {hasExpired ? "Expired" : date ? date.toLocaleDateString() : "Never"}
                        </Text>
                    )
                },
            },
            {
                title: "Last Used",
                dataIndex: "last_used_at",
                key: "last_used_at",
                render: (value: string) => {
                    if (value) {
                        return new Date(value).toLocaleString()
                    }

                    return "Never Used"
                },
            },
        ]

        if (!canEditApiKeys) {
            return baseColumns
        }

        return [
            ...baseColumns,
            {
                key: "action",
                render: (_: unknown, record: APIKey) => (
                    <Tooltip title="Delete">
                        <DeleteOutlined
                            onClick={() => deleteKey(record.prefix)}
                            style={{color: token.colorError}}
                        />
                    </Tooltip>
                ),
            },
        ]
    }, [canEditApiKeys, deleteKey, token.colorError])

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
            {canEditApiKeys ? (
                <div>
                    <Button
                        type="primary"
                        loading={loading[Loading.CREATE]}
                        icon={<Plus size={14} className="mt-0.2" />}
                        onClick={createKey}
                    >
                        Generate API key
                    </Button>
                </div>
            ) : null}
            <Table<APIKey>
                dataSource={keys}
                rowKey="prefix"
                pagination={false}
                loading={loading[Loading.LIST]}
                columns={columns}
            />

            <Modal
                title="Workspace ID Required"
                open={isModalVisible}
                onOk={() => setIsModalVisible(false)}
                onCancel={() => setIsModalVisible(false)}
            >
                <p>Please provide a valid Workspace ID to proceed with creating an API Key.</p>
            </Modal>
        </div>
    )
}

export default APIKeys

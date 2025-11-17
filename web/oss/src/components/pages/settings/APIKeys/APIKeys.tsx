import {useCallback, useEffect, useState} from "react"

import {CopyOutlined, DeleteOutlined, PlusOutlined} from "@ant-design/icons"
import {Alert, Button, Modal, Table, Tooltip, Typography, theme} from "antd"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useLoading} from "@/oss/hooks/useLoading"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {APIKey} from "@/oss/lib/Types"
import {createApiKey, deleteApiKey, fetchAllListApiKeys} from "@/oss/services/apiKeys/api"
import {useOrgData} from "@/oss/state/org"

import {Loading} from "./assets/constants"

const {Title, Text} = Typography

const APIKeys: React.FC = () => {
    const [keys, setKeys] = useState<APIKey[]>([])
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [loading, setLoading] = useLoading(Object.values(Loading))
    const {token} = theme.useToken()

    const {selectedOrg} = useOrgData()
    const workspaceId: string = selectedOrg?.default_workspace.id || ""

    const listKeys = () => {
        setLoading(Loading.LIST, true)
        fetchAllListApiKeys(workspaceId)
            .then((res) => {
                setKeys(res.data)
            })
            .catch(console.error)
            .finally(() => {
                setLoading(Loading.LIST, false)
            })
    }

    const deleteKey = useCallback((prefix: string) => {
        AlertPopup({
            title: "Delete API Key",
            message: "Are you sure you want to delete this API Key? This action is irreversible!",
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
    }, [])

    const createKey = useCallback(() => {
        setLoading(Loading.CREATE, true)
        if (!workspaceId || workspaceId.trim() === "") {
            setLoading(Loading.CREATE, false)
            setIsModalVisible(true)
        } else {
            createApiKey(workspaceId)
                .then(({data}) => {
                    listKeys()
                    AlertPopup({
                        width: 500,
                        type: "success",
                        title: "API Key created",
                        message: (
                            <div>
                                <div>
                                    Make sure to copy your API Key now. You won’t be able to see it
                                    again!
                                </div>
                                <div className="mt-[0.5rem]">
                                    <Text className="tracking-[0.08em]" strong type="secondary">
                                        {data}{" "}
                                        <Tooltip title="Copy">
                                            <CopyOutlined
                                                onClick={() => copyToClipboard(data)}
                                                style={{color: token.colorPrimary}}
                                            />
                                        </Tooltip>
                                    </Text>
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
    }, [])

    useEffect(() => {
        listKeys()
    }, [])

    return (
        <div>
            <Title level={3} className="mt-0">
                API Keys
            </Title>
            <Alert
                showIcon
                message="Note"
                description={
                    <span>
                        An API key can be used to access Agenta APIs securely. You can manage your
                        API Keys from here.
                        <br />
                        <br />
                        Your API key should be passed in as an{" "}
                        <code className="text-[#FF1493]">Authorization</code> header in the
                        requests. You can find examples of how to consume our APIs on the endpoints
                        page of an app or visit our{" "}
                        <a href="https://agenta.ai/docs/backend_api/">docs</a>.
                    </span>
                }
                type="info"
            />

            <div>
                <Button
                    type="primary"
                    loading={loading[Loading.CREATE]}
                    icon={<PlusOutlined />}
                    onClick={createKey}
                    className="mt-[2rem] mb-[1rem]"
                >
                    Create New
                </Button>
            </div>
            <Table<APIKey>
                dataSource={keys}
                rowKey="prefix"
                pagination={false}
                loading={loading[Loading.LIST]}
                columns={[
                    {
                        title: "API Key",
                        dataIndex: "prefix",
                        key: "prefix",
                        width: 400,
                        render: (value: string) => (
                            <Text className="tracking-[0.08em]" code>
                                {value.padEnd(40, "*")}
                            </Text>
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
                                    {hasExpired
                                        ? "Expired"
                                        : date
                                          ? date.toLocaleDateString()
                                          : "Never"}
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
                            } else {
                                return "Never Used"
                            }
                        },
                    },
                    {
                        key: "action",
                        render: (_, record) => (
                            <Tooltip title="Delete">
                                <DeleteOutlined
                                    onClick={() => deleteKey(record.prefix)}
                                    style={{color: token.colorError}}
                                />
                            </Tooltip>
                        ),
                    },
                ]}
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

import {useMemo, useState} from "react"

import {GearSix, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Table, Tag, Typography} from "antd"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"

const ModelRegistryTable = () => {
    const {customRowSecrets} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null)

    const columns: ColumnsType<LlmProvider> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return record?.name
                },
            },
            {
                title: "Type",
                dataIndex: "type",
                key: "type",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return record?.type
                },
            },
            {
                title: "Model",
                dataIndex: "model",
                key: "model",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return (
                        <div className="flex flex-col items-start gap-1">
                            <Tag
                                bordered={false}
                                color="default"
                                className="bg-[#0517290F] px-2 py-[1px]"
                            >
                                {record?.provider}
                            </Tag>
                        </div>
                    )
                },
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return dayjs(record.created_at).format("YYYY-MM-DD HH:mm")
                },
            },
            {
                title: <GearSix size={16} />,
                key: "key",
                width: 56,
                fixed: "right",
                align: "center",
                render: (_, record) => {
                    return (
                        <div className="flex items-center gap-1">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setIsDeleteModalOpen(true)
                                    setSelectedProvider(record)
                                }}
                                color="danger"
                                variant="text"
                                icon={<Trash />}
                            />
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setIsConfigProviderOpen(true)
                                    setSelectedProvider(record)
                                }}
                                type="text"
                                icon={<PencilSimpleLine />}
                            />
                        </div>
                    )
                },
            },
        ],
        [customRowSecrets],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">
                        Custom providers
                    </Typography.Text>

                    <Button
                        icon={<Plus size={14} />}
                        type="primary"
                        size="small"
                        onClick={() => setIsConfigProviderOpen(true)}
                    >
                        Create
                    </Button>
                </div>
                <Table
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={customRowSecrets}
                    bordered
                    pagination={false}
                    loading={false}
                />
            </section>

            <DeleteProviderModal
                open={isDeleteModalOpen}
                selectedProvider={selectedProvider}
                onCancel={() => {
                    setIsDeleteModalOpen(false)
                    setSelectedProvider(null)
                }}
            />

            <ConfigureProviderDrawer
                open={isConfigProviderOpen}
                selectedProvider={selectedProvider}
                onClose={() => {
                    setIsConfigProviderOpen(false)
                    setSelectedProvider(null)
                }}
            />
        </>
    )
}

export default ModelRegistryTable

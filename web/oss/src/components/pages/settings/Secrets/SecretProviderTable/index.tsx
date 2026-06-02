import {useMemo, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {LLMIconMap} from "@agenta/ui"
import {GearSix, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import ConfigureProviderModal from "@/oss/components/ModelRegistry/Modals/ConfigureProviderModal"
import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const SecretProviderTable = ({type}: {type: "standard" | "custom"}) => {
    const {customRowSecrets, secrets, loading} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null)
    const [isAddProviderSecretModalOpen, setIsAddProviderSecretModalOpen] = useState(false)

    const isCustom = type === "custom"

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
                    const Icon = LLMIconMap[record.title as string]

                    return isCustom ? (
                        record?.name
                    ) : (
                        <div className="flex items-center gap-2">
                            {Icon && <Icon className="w-6 h-6" />} <span>{record?.title}</span>
                        </div>
                    )
                },
            },
            ...(!isCustom
                ? [
                      {
                          title: "API Key",
                          dataIndex: "key",
                          key: "apiKey",
                          onHeaderCell: () => ({
                              style: {minWidth: 160},
                          }),
                          render: (_: any, record: LlmProvider) => {
                              const key = record.key as string
                              const displayKey = key.slice(0, 3) + "..." + key.slice(-3)

                              return (
                                  <>
                                      {record.key ? (
                                          <Typography.Text>{displayKey}</Typography.Text>
                                      ) : (
                                          <Button
                                              size="small"
                                              onClick={(e) => {
                                                  e.stopPropagation()
                                                  setIsAddProviderSecretModalOpen(true)
                                                  setSelectedProvider(record)
                                              }}
                                          >
                                              Configure now
                                          </Button>
                                      )}
                                  </>
                              )
                          },
                      },
                  ]
                : []),
            ...(isCustom
                ? [
                      {
                          title: "Provider",
                          dataIndex: "provider",
                          key: "provider",
                          onHeaderCell: () => ({
                              style: {minWidth: 160},
                          }),
                          render: (_: any, record: LlmProvider) => {
                              return (
                                  <div className="flex flex-col items-start gap-1">
                                      <Tag
                                          variant="filled"
                                          color="default"
                                          className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                                      >
                                          {record?.provider}
                                      </Tag>
                                  </div>
                              )
                          },
                      },
                      {
                          title: "Models",
                          dataIndex: "models",
                          key: "models",
                          onHeaderCell: () => ({
                              style: {minWidth: 200},
                          }),
                          render: (_: any, record: LlmProvider) => {
                              const models = record?.models ?? []

                              if (models.length === 0) {
                                  return <Typography.Text type="secondary">-</Typography.Text>
                              }

                              return (
                                  <div className="flex flex-wrap items-start gap-1">
                                      {models.map((model) => (
                                          <Tag
                                              key={model}
                                              variant="filled"
                                              color="default"
                                              className="bg-[#0517290F] px-2 py-[1px] m-0"
                                          >
                                              {model}
                                          </Tag>
                                      ))}
                                  </div>
                              )
                          },
                      },
                  ]
                : []),
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-"
                },
            },
            {
                title: <GearSix size={16} />,
                key: "key",
                width: 85,
                fixed: "right",
                align: "center",
                render: (_, record) => {
                    if ((!isCustom && record.key) || isCustom) {
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
                                    size="small"
                                />
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (isCustom) {
                                            setIsConfigProviderOpen(true)
                                        } else {
                                            setIsAddProviderSecretModalOpen(true)
                                        }
                                        setSelectedProvider(record)
                                    }}
                                    type="text"
                                    icon={<PencilSimpleLine />}
                                    size="small"
                                />
                            </div>
                        )
                    } else {
                        return null
                    }
                },
            },
        ],
        [customRowSecrets, secrets, type],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">
                        {isCustom ? "Custom providers" : "Standard providers"}
                    </Typography.Text>

                    {isCustom && (
                        <Button
                            icon={<Plus size={14} />}
                            type="primary"
                            size="small"
                            onClick={() => setIsConfigProviderOpen(true)}
                        >
                            Create
                        </Button>
                    )}
                </div>
                <Table
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={isCustom ? customRowSecrets : secrets}
                    rowKey={(record) => record.id || record.title || record.name || ""}
                    bordered
                    pagination={false}
                    loading={loading}
                />
            </section>

            <DeleteProviderModal
                open={isDeleteModalOpen}
                selectedProvider={selectedProvider}
                onCancel={() => {
                    setSelectedProvider(null)
                    setIsDeleteModalOpen(false)
                }}
            />

            <ConfigureProviderModal
                open={isAddProviderSecretModalOpen}
                selectedProvider={selectedProvider}
                onCancel={() => {
                    setSelectedProvider(null)
                    setIsAddProviderSecretModalOpen(false)
                }}
            />

            <ConfigureProviderDrawer
                open={isConfigProviderOpen}
                selectedProvider={selectedProvider}
                onClose={() => {
                    setSelectedProvider(null)
                    setIsConfigProviderOpen(false)
                }}
            />
        </>
    )
}

export default SecretProviderTable

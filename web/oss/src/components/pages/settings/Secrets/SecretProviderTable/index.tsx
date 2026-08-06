import {useMemo, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {LLMIconMap} from "@agenta/ui"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import ConfigureProviderModal from "@/oss/components/ModelRegistry/Modals/ConfigureProviderModal"
import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const SecretProviderTable = ({type}: {type: "standard" | "custom"}) => {
    const {customRowSecrets, secrets, loading, mutate} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null)
    const [isAddProviderSecretModalOpen, setIsAddProviderSecretModalOpen] = useState(false)

    const isCustom = type === "custom"

    interface ProviderRow extends LlmProvider {
        // Identity is rowId; key stays the API key, narrowed to string to meet the table base type.
        key: string
        rowId: string
        [extra: string]: unknown
    }

    const sourceRows = isCustom ? customRowSecrets : secrets

    const rows = useMemo<ProviderRow[]>(
        () =>
            (sourceRows ?? []).map((provider, index) => ({
                ...provider,
                key: provider.key ?? "",
                rowId: provider.id || provider.title || provider.name || `provider-${index}`,
            })),
        [sourceRows],
    )

    const configuredCount = useMemo(
        () => (secrets ?? []).filter((provider) => Boolean(provider.key)).length,
        [secrets],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<ProviderRow>([
                {
                    type: "text",
                    key: "name",
                    title: isCustom ? "Name" : "Provider",
                    width: 220,
                    render: (_value, record) => {
                        const Icon = LLMIconMap[record.title as string]
                        return isCustom ? (
                            record?.name
                        ) : (
                            <div className="flex items-center gap-2 min-w-0">
                                {Icon && <Icon className="w-5 h-5 shrink-0" />}
                                <span className="truncate">{record?.title}</span>
                            </div>
                        )
                    },
                },
                ...(!isCustom
                    ? [
                          {
                              type: "text",
                              key: "key",
                              title: "API key",
                              width: 260,
                              render: (_value: unknown, record: ProviderRow) => {
                                  const key = record.key as string | undefined
                                  if (!key) {
                                      return (
                                          <Button
                                              size="small"
                                              onClick={(e) => {
                                                  e.stopPropagation()
                                                  setIsAddProviderSecretModalOpen(true)
                                                  setSelectedProvider(record)
                                              }}
                                          >
                                              Add key
                                          </Button>
                                      )
                                  }
                                  return (
                                      <span className="font-mono text-xs">
                                          {`${key.slice(0, 3)}...${key.slice(-3)}`}
                                      </span>
                                  )
                              },
                          } satisfies StandardColumnDef<ProviderRow>,
                      ]
                    : []),
                ...(isCustom
                    ? [
                          {
                              type: "text",
                              key: "provider",
                              title: "Provider",
                              width: 180,
                              render: (_value: unknown, record: ProviderRow) => (
                                  <Tag
                                      variant="filled"
                                      color="default"
                                      className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                                  >
                                      {record?.provider}
                                  </Tag>
                              ),
                          } satisfies StandardColumnDef<ProviderRow>,
                          {
                              type: "text",
                              key: "models",
                              title: "Models",
                              width: 260,
                              render: (_value: unknown, record: ProviderRow) => {
                                  const models = record?.models ?? []
                                  if (models.length === 0)
                                      return <Typography.Text type="secondary">-</Typography.Text>
                                  return (
                                      <span className="truncate" title={models.join(", ")}>
                                          {models.join(", ")}
                                      </span>
                                  )
                              },
                          } satisfies StandardColumnDef<ProviderRow>,
                      ]
                    : []),
                {
                    type: "text",
                    key: "created_at",
                    title: "Connected",
                    width: 170,
                    render: (_value, record) =>
                        record.created_at
                            ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                            : "-",
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "edit",
                            label: isCustom ? "Edit endpoint" : "Edit key",
                            icon: <PencilSimpleLine size={16} />,
                            hidden: (record: ProviderRow) => !isCustom && !record.key,
                            onClick: (record: ProviderRow) => {
                                setSelectedProvider(record)
                                if (isCustom) setIsConfigProviderOpen(true)
                                else setIsAddProviderSecretModalOpen(true)
                            },
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: isCustom ? "Delete endpoint" : "Remove key",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: (record: ProviderRow) => !isCustom && !record.key,
                            onClick: (record: ProviderRow) => {
                                setSelectedProvider(record)
                                setIsDeleteModalOpen(true)
                            },
                        },
                    ],
                } satisfies StandardColumnDef<ProviderRow>,
            ]),
        [isCustom],
    )

    const {tableScope, pagination} = useStaticTable<ProviderRow>(
        isCustom ? "settings-llm-custom" : "settings-llm-standard",
        rows,
    )
    return (
        <>
            <section className="flex flex-col gap-2">
                <InfiniteVirtualTableFeatureShell<ProviderRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    columns={columns}
                    rowKey={(record) => record.rowId}
                    pagination={pagination}
                    // Fixed height sized to row count; autoHeight would grow unbounded here.
                    autoHeight={false}
                    rowHeight={40}
                    title={
                        <div className="flex flex-col gap-1">
                            <h3 className="m-0 font-medium text-colorText">
                                {isCustom ? "OpenAI-compatible endpoints" : "Standard providers"}
                            </h3>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                {isCustom
                                    ? "Self-hosted or proxied models that speak the OpenAI API."
                                    : `${configuredCount} of ${secrets?.length ?? 0} configured`}
                            </p>
                        </div>
                    }
                    primaryActions={
                        isCustom ? (
                            <>
                                <Tooltip title="Reload providers">
                                    <Button
                                        icon={<ArrowClockwise size={14} />}
                                        type="default"
                                        aria-label="Reload providers"
                                        loading={loading}
                                        onClick={mutate}
                                    />
                                </Tooltip>
                                <Button
                                    icon={<Plus size={14} />}
                                    type="primary"
                                    onClick={() => setIsConfigProviderOpen(true)}
                                >
                                    Add endpoint
                                </Button>
                            </>
                        ) : null
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        loading,
                        locale: {
                            emptyText: isCustom ? (
                                <EmptyState
                                    className="py-10"
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-base font-semibold text-colorText">
                                                No custom endpoints
                                            </span>
                                            <span>
                                                Point Agenta at a self-hosted or proxied model that
                                                speaks the OpenAI API.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={() => setIsConfigProviderOpen(true)}
                                    >
                                        Add endpoint
                                    </Button>
                                </EmptyState>
                            ) : (
                                <EmptyState
                                    className="py-10"
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-base font-semibold text-colorText">
                                                No providers available
                                            </span>
                                            <span>
                                                Standard providers appear here once they are
                                                available for your workspace.
                                            </span>
                                        </div>
                                    }
                                />
                            ),
                        },
                    }}
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

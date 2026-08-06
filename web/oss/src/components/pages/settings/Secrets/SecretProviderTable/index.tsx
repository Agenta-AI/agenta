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
        // `key` is the virtual table's unique row identity. The provider's own key (the API
        // secret) would be "" for every unconfigured provider and collapse the rows, so it
        // lives on `source` — the untouched provider handed to the modals.
        key: string
        source: LlmProvider
        [extra: string]: unknown
    }

    const sourceRows = isCustom ? customRowSecrets : secrets

    const rows = useMemo<ProviderRow[]>(
        () =>
            (sourceRows ?? []).map((provider, index) => ({
                ...provider,
                key: provider.id || provider.title || provider.name || `provider-${index}`,
                source: provider,
            })),
        [sourceRows],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<ProviderRow>([
                {
                    type: "text",
                    key: "name",
                    title: isCustom ? "Name" : "Provider",
                    width: 320,
                    fixed: "left",
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
                                  const apiKey = record.source.key
                                  if (!apiKey) {
                                      return (
                                          <Button
                                              size="small"
                                              onClick={(e) => {
                                                  e.stopPropagation()
                                                  setIsAddProviderSecretModalOpen(true)
                                                  setSelectedProvider(record.source)
                                              }}
                                          >
                                              Configure now
                                          </Button>
                                      )
                                  }
                                  return (
                                      <span className="font-mono text-xs">
                                          {`${apiKey.slice(0, 3)}...${apiKey.slice(-3)}`}
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
                            hidden: (record: ProviderRow) => !isCustom && !record.source.key,
                            onClick: (record: ProviderRow) => {
                                setSelectedProvider(record.source)
                                if (isCustom) setIsConfigProviderOpen(true)
                                else setIsAddProviderSecretModalOpen(true)
                            },
                        },
                        {
                            key: "delete",
                            label: isCustom ? "Delete endpoint" : "Remove key",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: (record: ProviderRow) => !isCustom && !record.source.key,
                            onClick: (record: ProviderRow) => {
                                setSelectedProvider(record.source)
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
        {loading},
    )
    return (
        <>
            <section className="flex flex-col gap-2">
                <InfiniteVirtualTableFeatureShell<ProviderRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    columns={columns}
                    rowKey="key"
                    pagination={pagination}
                    // Fixed height sized to row count; autoHeight would grow unbounded here.
                    autoHeight={false}
                    rowHeight={40}
                    title={
                        <div className="flex flex-col gap-1">
                            <h3 className="m-0 font-medium text-colorText">
                                {isCustom ? "OpenAI-compatible endpoints" : "Standard providers"}
                            </h3>
                            {isCustom ? (
                                <p className="m-0 font-normal text-colorTextSecondary">
                                    Self-hosted or proxied models that speak the OpenAI API.
                                </p>
                            ) : null}
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
                                    disabled={loading}
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
                        locale: {
                            emptyText: isCustom ? (
                                <EmptyState
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium text-colorText">
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
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium text-colorText">
                                                No providers to show
                                            </span>
                                            <span>
                                                The provider list could not be loaded. Reload the
                                                page to try again.
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

import {useMemo, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {useStaticTable} from "@agenta/settings"
import type {LlmProvider} from "@agenta/shared/types"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {LLMIconMap} from "@agenta/ui/llm-icons"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

export interface ProviderDialogState {
    selectedProvider: LlmProvider | null
    open: boolean
    onClose: () => void
}

export interface SecretProviderTableProps {
    type: "standard" | "custom"
    /** Provider dialogs belong to the model registry, not settings; the host renders its own. */
    renderDeleteDialog?: (state: ProviderDialogState) => React.ReactNode
    renderConfigureDialog?: (state: ProviderDialogState) => React.ReactNode
    renderConfigureDrawer?: (state: ProviderDialogState) => React.ReactNode
}

export const SecretProviderTable = ({
    type,
    renderDeleteDialog,
    renderConfigureDialog,
    renderConfigureDrawer,
}: SecretProviderTableProps) => {
    const {customRowSecrets, secrets, loading, mutate} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null)
    const [isAddProviderSecretModalOpen, setIsAddProviderSecretModalOpen] = useState(false)

    const isCustom = type === "custom"
    // Absent rather than dead: without the host's surface these open nothing.
    const canConfigure = isCustom ? Boolean(renderConfigureDrawer) : Boolean(renderConfigureDialog)
    const canDelete = Boolean(renderDeleteDialog)

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

    const columns = useMemo<DataTableColumn<ProviderRow>[]>(
        () => [
            {
                key: "name",
                title: isCustom ? "Name" : "Provider",
                width: 320,
                render: (record) => {
                    const Icon = LLMIconMap[record.title as string]
                    return isCustom ? (
                        record?.name
                    ) : (
                        <div className="flex min-w-0 items-center gap-2">
                            {Icon && <Icon className="size-5 shrink-0" />}
                            <span className="truncate">{record?.title}</span>
                        </div>
                    )
                },
            },
            ...(!isCustom
                ? [
                      {
                          key: "key",
                          title: "API key",
                          width: 260,
                          render: (record: ProviderRow) => {
                              const apiKey = record.source.key
                              if (!apiKey) {
                                  if (!canConfigure) {
                                      return <span className="text-colorTextSecondary">-</span>
                                  }
                                  return (
                                      <Button
                                          size="sm"
                                          variant="outline"
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
                      } satisfies DataTableColumn<ProviderRow>,
                  ]
                : []),
            ...(isCustom
                ? [
                      {
                          key: "provider",
                          title: "Provider",
                          width: 180,
                          render: (record: ProviderRow) => <Tag>{record?.provider}</Tag>,
                      } satisfies DataTableColumn<ProviderRow>,
                      {
                          key: "models",
                          title: "Models",
                          width: 260,
                          render: (record: ProviderRow) => {
                              const models = record?.models ?? []
                              if (models.length === 0)
                                  return <span className="text-colorTextSecondary">-</span>
                              return (
                                  <span className="block truncate" title={models.join(", ")}>
                                      {models.join(", ")}
                                  </span>
                              )
                          },
                      } satisfies DataTableColumn<ProviderRow>,
                  ]
                : []),
            {
                key: "created_at",
                title: "Connected",
                width: 170,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [isCustom, canConfigure],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <DataTable<ProviderRow>
                    className="ph-no-capture"
                    columns={columns}
                    rows={rows}
                    rowKey={(record) => record.key}
                    loading={loading}
                    actions={(record) => [
                        {
                            key: "edit",
                            label: isCustom ? "Edit endpoint" : "Edit key",
                            icon: <PencilSimpleLine size={16} />,
                            hidden: !canConfigure || (!isCustom && !record.source.key),
                            onClick: () => {
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
                            hidden: !canDelete || (!isCustom && !record.source.key),
                            onClick: () => {
                                setSelectedProvider(record.source)
                                setIsDeleteModalOpen(true)
                            },
                        },
                    ]}
                    title={
                        <div className="flex flex-col gap-1">
                            <p className="m-0 font-medium text-colorText">
                                {isCustom ? "OpenAI-compatible endpoints" : "Standard providers"}
                            </p>
                            {isCustom ? (
                                <p className="m-0 font-normal text-colorTextSecondary">
                                    Self-hosted or proxied models that speak the OpenAI API.
                                </p>
                            ) : null}
                        </div>
                    }
                    onReload={mutate}
                    reloading={loading}
                    reloadLabel="Reload providers"
                    primaryActions={
                        isCustom && canConfigure ? (
                            <Button
                                disabled={loading}
                                onClick={() => setIsConfigProviderOpen(true)}
                            >
                                <Plus size={14} />
                                Add endpoint
                            </Button>
                        ) : null
                    }
                    empty={
                        isCustom ? (
                            <EmptyState
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-colorText">
                                            No custom endpoints
                                        </span>
                                        <span>
                                            Point Agenta at a self-hosted or proxied model that
                                            speaks the OpenAI API.
                                        </span>
                                    </div>
                                }
                            >
                                {canConfigure ? (
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsConfigProviderOpen(true)}
                                    >
                                        <Plus size={14} />
                                        Add endpoint
                                    </Button>
                                ) : null}
                            </EmptyState>
                        ) : (
                            <EmptyState
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-colorText">
                                            No providers to show
                                        </span>
                                        <span>
                                            The provider list could not be loaded. Reload the page
                                            to try again.
                                        </span>
                                    </div>
                                }
                            />
                        )
                    }
                />
            </section>

            {renderDeleteDialog?.({
                selectedProvider,
                open: isDeleteModalOpen,
                onClose: () => {
                    setSelectedProvider(null)
                    setIsDeleteModalOpen(false)
                },
            })}

            {renderConfigureDialog?.({
                selectedProvider,
                open: isAddProviderSecretModalOpen,
                onClose: () => {
                    setSelectedProvider(null)
                    setIsAddProviderSecretModalOpen(false)
                },
            })}

            {renderConfigureDrawer?.({
                selectedProvider,
                open: isConfigProviderOpen,
                onClose: () => {
                    setSelectedProvider(null)
                    setIsConfigProviderOpen(false)
                },
            })}
        </>
    )
}

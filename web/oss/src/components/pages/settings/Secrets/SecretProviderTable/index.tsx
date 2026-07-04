import {useMemo, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import type {LlmProvider} from "@agenta/shared/types"
import {LLMIconMap} from "@agenta/ui"
import {ArrowClockwise, GearSix, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

import ConfigureProviderDrawer from "@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer"
import ConfigureProviderModal from "@/oss/components/ModelRegistry/Modals/ConfigureProviderModal"
import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const SecretProviderTable = ({type}: {type: "standard" | "custom"}) => {
    const {customRowSecrets, secrets, loading, mutate} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigProviderOpen, setIsConfigProviderOpen] = useState(false)
    const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null)
    const [isAddProviderSecretModalOpen, setIsAddProviderSecretModalOpen] = useState(false)

    const isCustom = type === "custom"

    const columns: ColumnDef<LlmProvider, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                accessorKey: "name",
                header: "Name",
                minSize: 160,
                cell: ({row}) => {
                    const record = row.original
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
                          id: "apiKey",
                          accessorKey: "key",
                          header: "API Key",
                          minSize: 160,
                          cell: ({row}: {row: {original: LlmProvider}}) => {
                              const record = row.original
                              const key = record.key as string
                              const displayKey = key.slice(0, 3) + "..." + key.slice(-3)

                              return record.key ? (
                                  <span>{displayKey}</span>
                              ) : (
                                  <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                          e.stopPropagation()
                                          setIsAddProviderSecretModalOpen(true)
                                          setSelectedProvider(record)
                                      }}
                                  >
                                      Configure now
                                  </Button>
                              )
                          },
                      } satisfies ColumnDef<LlmProvider, unknown>,
                  ]
                : []),
            ...(isCustom
                ? [
                      {
                          id: "provider",
                          accessorKey: "provider",
                          header: "Provider",
                          minSize: 160,
                          cell: ({row}: {row: {original: LlmProvider}}) => (
                              <div className="flex flex-col items-start gap-1">
                                  <Badge variant="secondary">{row.original?.provider}</Badge>
                              </div>
                          ),
                      } satisfies ColumnDef<LlmProvider, unknown>,
                      {
                          id: "models",
                          accessorKey: "models",
                          header: "Models",
                          minSize: 200,
                          cell: ({row}: {row: {original: LlmProvider}}) => {
                              const models = row.original?.models ?? []

                              if (models.length === 0) {
                                  return <span className="text-muted-foreground">-</span>
                              }

                              return (
                                  <div className="flex flex-wrap items-start gap-1">
                                      {models.map((model) => (
                                          <Badge key={model} variant="secondary">
                                              {model}
                                          </Badge>
                                      ))}
                                  </div>
                              )
                          },
                      } satisfies ColumnDef<LlmProvider, unknown>,
                  ]
                : []),
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Created at",
                minSize: 160,
                cell: ({row}) => {
                    const record = row.original
                    return record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-"
                },
            },
            {
                id: "actions",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 96,
                cell: ({row}) => {
                    const record = row.original
                    if ((!isCustom && record.key) || isCustom) {
                        return (
                            <div className="flex items-center justify-center gap-1">
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setIsDeleteModalOpen(true)
                                        setSelectedProvider(record)
                                    }}
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Delete provider"
                                >
                                    <Trash className="text-destructive" />
                                </Button>
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
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Edit provider"
                                >
                                    <PencilSimpleLine />
                                </Button>
                            </div>
                        )
                    }
                    return null
                },
            },
        ],
        [customRowSecrets, secrets, type],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                {/* Standard's label is a disabled pill so both sections' header rows match height. */}
                <div className="flex items-center gap-2">
                    {isCustom ? (
                        <Button size="sm" onClick={() => setIsConfigProviderOpen(true)}>
                            <Plus size={14} />
                            Custom Provider
                        </Button>
                    ) : (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            className="!bg-transparent !text-muted-foreground !cursor-default disabled:opacity-100"
                        >
                            Standard providers
                        </Button>
                    )}
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload providers"
                                    disabled={loading}
                                    onClick={() => mutate()}
                                >
                                    {loading ? <Spinner /> : <ArrowClockwise size={14} />}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload providers</TooltipContent>
                    </Tooltip>
                </div>
                <div className="ph-no-capture">
                    <DataTable<LlmProvider>
                        columns={columns}
                        data={isCustom ? customRowSecrets : secrets}
                        getRowId={(record) => record.id || record.title || record.name || ""}
                        loading={loading}
                        enableSorting={false}
                    />
                </div>
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

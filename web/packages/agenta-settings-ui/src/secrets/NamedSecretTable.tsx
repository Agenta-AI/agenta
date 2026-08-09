import {useMemo, useState} from "react"

import {CustomSecretFormat, useVaultSecret, type NamedSecretRow} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Tag} from "@agenta/ui/components/presentational"
import {Button, Tooltip, TooltipContent, TooltipTrigger} from "@agenta/ui/ui"

import {useStaticTable} from "@agenta/settings"
import {formatDay} from "@agenta/shared/utils/dateTime"


/**
 * Mask stored secret content for display. `text` is masked like an API key
 * (first/last few chars); `json` shows the key names only, never the values.
 */
const maskContent = (record: NamedSecretRow): string => {
    const {format, content} = record
    if (format === CustomSecretFormat.Json) {
        const keys = content && typeof content === "object" ? Object.keys(content) : []
        return keys.length ? `{ ${keys.join(", ")} }` : "{ }"
    }
    const text = typeof content === "string" ? content : ""
    if (text.length <= 6) return text ? "•••" : "-"
    return `${text.slice(0, 3)}...${text.slice(-3)}`
}

export interface NamedSecretTableProps {
    /** Create/edit secret dialog — the host's. */
    renderConfigureDialog?: (state: {
        selectedSecret: NamedSecretRow | null
        open: boolean
        onClose: () => void
    }) => React.ReactNode
    /** Delete dialog — the model registry's. */
    renderDeleteDialog?: (state: {
        selectedProvider: LlmProvider | null
        open: boolean
        onClose: () => void
    }) => React.ReactNode
}

export const NamedSecretTable = ({
    renderConfigureDialog,
    renderDeleteDialog,
}: NamedSecretTableProps) => {
    const {namedSecrets, loading, mutate} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
    const [selectedSecret, setSelectedSecret] = useState<NamedSecretRow | null>(null)

    interface SecretRow extends NamedSecretRow {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<SecretRow[]>(
        () =>
            (namedSecrets ?? []).map((secret, index) => ({
                ...secret,
                key: secret.id || secret.name || `secret-${index}`,
            })),
        [namedSecrets],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<SecretRow>([
                {type: "text", key: "name", title: "Name", width: 200, fixed: "left"},
                {type: "slug", key: "slug", title: "Slug", width: 240},
                {
                    type: "text",
                    key: "content",
                    title: "Value",
                    width: 200,
                    render: (_value, record) => (
                        <span className="ph-no-capture">
                            {maskContent(record)}
                        </span>
                    ),
                },
                {
                    type: "text",
                    key: "format",
                    title: "Format",
                    width: 120,
                    render: (_value, record) => (
                        <Tag
                            className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                        >
                            {record.format}
                        </Tag>
                    ),
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Created",
                    width: 160,
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
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: SecretRow) => {
                                setSelectedSecret(record)
                                setIsConfigModalOpen(true)
                            },
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: SecretRow) => {
                                setSelectedSecret(record)
                                setIsDeleteModalOpen(true)
                            },
                        },
                    ],
                } satisfies StandardColumnDef<SecretRow>,
            ]),
        [],
    )

    const {tableScope, pagination} = useStaticTable<SecretRow>("settings-vault-secrets", rows, {
        loading,
    })
    return (
        <>
            <div className="flex flex-col gap-2">
                <InfiniteVirtualTableFeatureShell<SecretRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    primaryActions={
                        <>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        aria-label="Reload secrets"
                                        disabled={loading}
                                        onClick={mutate}
                                    >
                                        <ArrowClockwise size={14} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reload secrets</TooltipContent>
                            </Tooltip>
                            <Button
                                disabled={loading}
                                onClick={() => {
                                    setSelectedSecret(null)
                                    setIsConfigModalOpen(true)
                                }}
                            >
                                <Plus size={14} />
                                Create secret
                            </Button>
                        </>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        locale: {
                            emptyText: (
                                <EmptyState
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs font-medium text-colorText">
                                                No secrets yet
                                            </span>
                                            <span>
                                                Store a named secret to reference credentials
                                                without exposing their values.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setSelectedSecret(null)
                                            setIsConfigModalOpen(true)
                                        }}
                                    >
                                        <Plus size={14} />
                                        Create secret
                                    </Button>
                                </EmptyState>
                            ),
                        },
                    }}
                />
            </div>

            {renderConfigureDialog?.({
                selectedSecret,
                open: isConfigModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsConfigModalOpen(false)
                },
            })}

            {renderDeleteDialog?.({
                selectedProvider: selectedSecret as unknown as LlmProvider | null,
                open: isDeleteModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsDeleteModalOpen(false)
                },
            })}

        </>
    )
}

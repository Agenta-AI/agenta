import {useMemo, useState} from "react"

import {CustomSecretFormat, useVaultSecret, type NamedSecretRow} from "@agenta/entities/secret"
import {useStaticTable} from "@agenta/settings"
import type {LlmProvider} from "@agenta/shared/types"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

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

    const columns = useMemo<DataTableColumn<SecretRow>[]>(
        () => [
            {key: "name", title: "Name", width: 200, render: (record) => record.name},
            {key: "slug", title: "Slug", width: 240, mono: true, render: (record) => record.slug},
            {
                key: "content",
                title: "Value",
                width: 200,
                render: (record) => <span className="ph-no-capture">{maskContent(record)}</span>,
            },
            {
                key: "format",
                title: "Format",
                width: 120,
                render: (record) => <Tag>{record.format}</Tag>,
            },
            {
                key: "created_at",
                title: "Created",
                width: 160,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [],
    )

    return (
        <>
            <div className="flex flex-col gap-2">
                <DataTable<SecretRow>
                    className="ph-no-capture"
                    columns={columns}
                    rows={rows}
                    rowKey={(record) => record.key}
                    loading={loading}
                    actions={(record) => [
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            hidden: !renderConfigureDialog,
                            onClick: () => {
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
                            hidden: !renderDeleteDialog,
                            onClick: () => {
                                setSelectedSecret(record)
                                setIsDeleteModalOpen(true)
                            },
                        },
                    ]}
                    onReload={mutate}
                    reloading={loading}
                    reloadLabel="Reload secrets"
                    primaryActions={
                        // The form is the host's; without one this would open nothing, so it
                        // is absent rather than dead.
                        renderConfigureDialog ? (
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
                        ) : null
                    }
                    empty={
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No secrets yet
                                    </span>
                                    <span>
                                        Store a named secret to reference credentials without
                                        exposing their values.
                                    </span>
                                </div>
                            }
                        >
                            {renderConfigureDialog ? (
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
                            ) : null}
                        </EmptyState>
                    }
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
                // `NamedSecretRow extends LlmProvider`, so the row IS the provider shape the
                // registry's delete dialog takes — no cast needed.
                selectedProvider: selectedSecret,
                open: isDeleteModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsDeleteModalOpen(false)
                },
            })}
        </>
    )
}

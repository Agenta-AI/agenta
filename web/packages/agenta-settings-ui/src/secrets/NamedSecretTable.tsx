import {useMemo, useState} from "react"

import {CustomSecretFormat, useVaultSecret, type NamedSecretRow} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, IconTile} from "@agenta/ui/ui"
import {LockKey, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

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

interface SecretRow extends NamedSecretRow {
    key: string
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(0,2fr)"},
    {key: "content", label: "Value", width: "minmax(0,1fr)"},
    {key: "format", label: "Format", width: "minmax(0,0.6fr)"},
    {key: "created_at", label: "Created", width: "minmax(0,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["name", "actions"]

export const NamedSecretTable = ({
    renderConfigureDialog,
    renderDeleteDialog,
}: NamedSecretTableProps) => {
    const {namedSecrets, loading} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
    const [selectedSecret, setSelectedSecret] = useState<NamedSecretRow | null>(null)
    const {columns, shows} = usePhoneColumns(COLUMNS, PHONE_KEYS)

    const rows = useMemo<SecretRow[]>(
        () =>
            (namedSecrets ?? []).map((secret, index) => ({
                ...secret,
                key: secret.id || secret.name || `secret-${index}`,
            })),
        [namedSecrets],
    )

    const openCreate = () => {
        setSelectedSecret(null)
        setIsConfigModalOpen(true)
    }

    // The form is the host's; without one this would open nothing, so it is absent rather than dead.
    const create = renderConfigureDialog ? (
        <Button disabled={loading} onClick={openCreate}>
            <Plus size={14} />
            Create secret
        </Button>
    ) : null

    return (
        <>
            <section className="flex flex-col">
                <SettingsPageActions>{create}</SettingsPageActions>
                <ListTable<SecretRow>
                    className="ph-no-capture"
                    columns={columns}
                    groups={[{key: "secrets", label: null, rows}]}
                    wrapRow={hoverableRow}
                    rowKey={(record) => record.key}
                    minWidth={0}
                    onOpenRow={
                        renderConfigureDialog
                            ? (record) => {
                                  setSelectedSecret(record)
                                  setIsConfigModalOpen(true)
                              }
                            : undefined
                    }
                    loading={loading && rows.length === 0}
                    hideHeader={!loading && rows.length === 0}
                    empty={
                        <SettingsEmpty
                            icon={<LockKey size={18} />}
                            title="No secrets yet"
                            description="Store a named secret to reference credentials without exposing their values."
                            action={create}
                        />
                    }
                    renderRow={(record) => (
                        <>
                            <span className="flex min-w-0 items-center gap-2.5">
                                <IconTile
                                    size={28}
                                    tone="muted"
                                    aria-hidden="true"
                                    className="border border-solid border-border bg-muted text-muted-foreground"
                                >
                                    <LockKey />
                                </IconTile>
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-medium">{record.name}</span>
                                    <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                                        {record.slug}
                                    </span>
                                </span>
                            </span>
                            {shows("content") ? (
                                <span className="ph-no-capture truncate font-mono text-[13px]">
                                    {maskContent(record)}
                                </span>
                            ) : null}
                            {shows("format") ? (
                                <span className="flex min-w-0">
                                    <Tag>{record.format}</Tag>
                                </span>
                            ) : null}
                            {shows("created_at") ? (
                                <span className="truncate text-muted-foreground">
                                    {record.created_at
                                        ? formatDay({
                                              date: record.created_at,
                                              outputFormat: "YYYY-MM-DD HH:mm",
                                          })
                                        : "-"}
                                </span>
                            ) : null}
                            <SettingsRowMenu
                                label="Secret actions"
                                items={[
                                    {
                                        key: "edit",
                                        label: "Edit",
                                        icon: <PencilSimpleLine size={14} />,
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
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !renderDeleteDialog,
                                        onClick: () => {
                                            setSelectedSecret(record)
                                            setIsDeleteModalOpen(true)
                                        },
                                    },
                                ]}
                            />
                        </>
                    )}
                />
            </section>

            {renderConfigureDialog?.({
                selectedSecret,
                open: isConfigModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsConfigModalOpen(false)
                },
            })}

            {renderDeleteDialog?.({
                // `NamedSecretRow extends LlmProvider`, so this needs no cast — the double
                // assertion that was here would have hidden a real mismatch if the types drifted.
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

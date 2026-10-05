import type {ApiKeyRow} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Alert, Button} from "@agenta/ui/ui"
import {Key, Plus, Trash} from "@phosphor-icons/react"

import {SettingsPageActions} from "./SettingsPageShell"
import {SettingsEmpty} from "./shared/SettingsEmpty"
import {SettingsRowMenu} from "./shared/SettingsRowMenu"
import {SettingsToolbar} from "./shared/SettingsToolbar"

export interface ApiKeysPageProps {
    rows: ApiKeyRow[]
    listing: boolean
    creating: boolean
    canView: boolean
    canEdit: boolean
    onReload: () => void
    onCreate: () => void
    onDelete: (prefix: string) => void
}

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "—")

const COLUMNS: ListTableColumn[] = [
    {key: "prefix", label: "API key", width: "minmax(180px,2fr)"},
    {key: "created_at", label: "Created", width: "minmax(96px,1fr)"},
    {key: "expiration_date", label: "Expires", width: "minmax(96px,1fr)"},
    {key: "last_used_at", label: "Last used", width: "minmax(140px,1.4fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

const ExpiresCell = ({value}: {value?: string | null}) => {
    const date = value ? new Date(value) : null
    if (!date) return <span className="text-muted-foreground">Never</span>
    return date < new Date() ? (
        <StatusIndicator tone="error" label="Expired" />
    ) : (
        <span>{date.toLocaleDateString()}</span>
    )
}

/**
 * The API keys table: the prefix, when it was made, when it expires, when it was last used.
 *
 * Purely a view — the list and the verbs come from `useApiKeys`, so a host adds only its own
 * confirm dialog and one-time reveal of a newly created key.
 */
export const ApiKeysPage = ({
    rows,
    listing,
    creating,
    canView,
    canEdit,
    onReload,
    onCreate,
    onDelete,
}: ApiKeysPageProps) => {
    if (!canView) {
        return (
            <Alert
                type="warning"
                showIcon
                message="You do not have access to API Keys in this project."
            />
        )
    }

    const generate = canEdit ? (
        <Button size="sm" disabled={creating || listing} onClick={onCreate}>
            <Plus size={14} />
            Generate key
        </Button>
    ) : null

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{generate}</SettingsPageActions>
            <SettingsToolbar
                onReload={onReload}
                reloading={listing}
                reloadLabel="Reload API keys"
            />
            <ListTable<ApiKeyRow>
                columns={COLUMNS}
                groups={[{key: "keys", label: null, rows}]}
                rowKey={(record) => record.key}
                loading={listing && rows.length === 0}
                hideHeader={!listing && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={<Key size={18} />}
                        title="No API keys yet"
                        description="Generate a key to authenticate requests to the Agenta API from your code, CI jobs, and SDKs."
                        action={generate}
                    />
                }
                renderRow={(record) => (
                    <>
                        <span className="truncate font-mono text-[13px]">
                            {record.prefix.padEnd(20, "\u2022")}
                        </span>
                        <span className="truncate">{formatDate(record.created_at)}</span>
                        <ExpiresCell value={record.expiration_date} />
                        <span className="truncate text-muted-foreground">
                            {record.last_used_at
                                ? new Date(record.last_used_at).toLocaleString()
                                : "Never used"}
                        </span>
                        <SettingsRowMenu
                            label="Key actions"
                            items={[
                                {
                                    key: "delete",
                                    label: "Delete key",
                                    icon: <Trash size={14} />,
                                    danger: true,
                                    hidden: !canEdit,
                                    onClick: () => onDelete(record.prefix),
                                },
                            ]}
                        />
                    </>
                )}
            />
        </section>
    )
}

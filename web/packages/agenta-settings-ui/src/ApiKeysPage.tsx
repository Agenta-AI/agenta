import {useMemo} from "react"

import {useT} from "@agenta/i18n/settings"
import {getSettingsSidebarIcon, type ApiKeyRow} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Alert, Button} from "@agenta/ui/ui"
import {Plus, Trash} from "@phosphor-icons/react"

import {SettingsPageActions} from "./SettingsPageShell"
import {hoverableRow} from "./shared/hoverableRow"
import {SettingsEmpty} from "./shared/SettingsEmpty"
import {SettingsRowMenu} from "./shared/SettingsRowMenu"
import {usePhoneColumns} from "./shared/usePhoneColumns"

export interface ApiKeysPageProps {
    rows: ApiKeyRow[]
    listing: boolean
    creating: boolean
    canView: boolean
    canEdit: boolean
    onCreate: () => void
    onDelete: (prefix: string) => void
}

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "—")

const columnsFor = (t: ReturnType<typeof useT>): ListTableColumn[] => [
    {key: "prefix", label: t("settings.apiKeys.apiKey"), width: "minmax(0,2fr)"},
    {key: "created_at", label: t("common.created"), width: "minmax(0,1fr)"},
    {key: "expiration_date", label: t("settings.apiKeys.expires"), width: "minmax(0,1fr)"},
    {key: "last_used_at", label: t("settings.apiKeys.lastUsed"), width: "minmax(0,1.4fr)"},
    {key: "actions", label: t("common.actions"), srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["prefix", "expiration_date", "actions"]

const ExpiresCell = ({value}: {value?: string | null}) => {
    const t = useT()
    const date = value ? new Date(value) : null
    if (!date) return <span className="text-muted-foreground">{t("settings.apiKeys.never")}</span>
    return date < new Date() ? (
        <StatusIndicator tone="error" label={t("settings.apiKeys.expired")} />
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
    onCreate,
    onDelete,
}: ApiKeysPageProps) => {
    const t = useT()
    const {columns, shows} = usePhoneColumns(
        useMemo(() => columnsFor(t), [t]),
        PHONE_KEYS,
    )
    if (!canView) {
        return <Alert type="warning" showIcon message={t("settings.apiKeys.noAccess")} />
    }

    const generate = canEdit ? (
        <Button disabled={creating || listing} onClick={onCreate}>
            <Plus size={14} />
            {t("settings.apiKeys.generateKey")}
        </Button>
    ) : null

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{generate}</SettingsPageActions>
            <ListTable<ApiKeyRow>
                columns={columns}
                minWidth={0}
                groups={[{key: "keys", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                loading={listing && rows.length === 0}
                hideHeader={!listing && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("apiKeys")}
                        title={t("settings.apiKeys.emptyTitle")}
                        description={t("settings.apiKeys.emptyDescription")}
                        action={generate}
                    />
                }
                renderRow={(record) => (
                    <>
                        <span className="truncate font-mono text-[13px]">
                            {record.prefix.padEnd(20, "\u2022")}
                        </span>
                        {shows("created_at") ? (
                            <span className="truncate">{formatDate(record.created_at)}</span>
                        ) : null}
                        <ExpiresCell value={record.expiration_date} />
                        {shows("last_used_at") ? (
                            <span className="truncate text-muted-foreground">
                                {record.last_used_at
                                    ? new Date(record.last_used_at).toLocaleString()
                                    : t("settings.apiKeys.neverUsed")}
                            </span>
                        ) : null}
                        <SettingsRowMenu
                            label={t("settings.apiKeys.keyActions")}
                            items={[
                                {
                                    key: "delete",
                                    label: t("settings.apiKeys.deleteKey"),
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

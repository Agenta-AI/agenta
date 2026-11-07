import {useMemo, type ReactNode} from "react"

import type {OrganizationProvider} from "@agenta/entities/organization"
import {type TranslationKey} from "@agenta/i18n"
import {useT} from "@agenta/i18n/settings"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {SettingsToolbar} from "../shared/SettingsToolbar"
import {usePhoneColumns} from "../shared/usePhoneColumns"

const COLUMNS: (ListTableColumn & {label: TranslationKey<"common" | "settings">})[] = [
    {key: "slug", label: "settings.access.provider", width: "minmax(0,1.2fr)"},
    {key: "callback_url", label: "settings.access.callbackUrl", width: "minmax(0,2.4fr)"},
    {key: "status", label: "common.status", width: "minmax(0,1fr)"},
    {key: "enable", label: "common.enable", srOnly: true, width: "72px"},
    {key: "actions", label: "common.actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["slug", "status", "enable", "actions"]

export interface SsoProvidersSectionProps {
    providers: OrganizationProvider[]
    loading?: boolean
    /** Builds the IdP redirect URI; it needs the org slug, so the host owns it. */
    callbackUrlFor?: (provider: OrganizationProvider) => string | null
    onAdd?: () => void
    /** SSO needs an org slug first, so the host may be offering to set that instead. */
    addLabel?: string
    onEdit?: (provider: OrganizationProvider) => void
    onEnable?: (provider: OrganizationProvider) => void
    onDelete?: (provider: OrganizationProvider) => void
    enabling?: boolean
    deleting?: boolean
    /** Setup detail under a provider that is not yet valid; copy affordances are the host's. */
    renderInstructions?: (provider: OrganizationProvider) => ReactNode
    /** The org-slug field and its warning sit between the heading and the table. */
    children?: ReactNode
}

/**
 * Both read the flag the BACKEND reads, the way it reads it. `EnableSsoUseCase` gates on
 * `(provider.flags or {}).get("is_active") and .get("is_valid")` — truthy, so an omitted flag
 * means NOT active. This used to test `is_enabled !== false`, which is both a different flag and
 * the opposite default: a provider the backend refuses to enable SSO with rendered here as
 * enabled and verified.
 */
const isEnabled = (provider: OrganizationProvider) => provider.flags?.is_active === true
const isValid = (provider: OrganizationProvider) => provider.flags?.is_valid === true

/** The identity providers members can sign in through. */
export const SsoProvidersSection = ({
    providers,
    loading = false,
    callbackUrlFor,
    onAdd,
    addLabel,
    onEdit,
    onEnable,
    onDelete,
    enabling,
    deleting,
    renderInstructions,
    children,
}: SsoProvidersSectionProps) => {
    const t = useT()
    const translatedColumns = useMemo(
        () => COLUMNS.map((column) => ({...column, label: t(column.label)})),
        [t],
    )
    const {columns, shows} = usePhoneColumns(translatedColumns, PHONE_KEYS)
    const addButton = (variant?: "outline") =>
        onAdd ? (
            <Button variant={variant} onClick={onAdd} disabled={loading}>
                <Plus size={14} />
                {addLabel ?? t("settings.access.addProvider")}
            </Button>
        ) : null

    return (
        <section className="flex flex-col">
            <div className="mb-3">
                <h2 className="m-0 text-[13px] font-medium leading-[18px] text-muted-foreground">
                    {t("settings.access.ssoProviders")}
                </h2>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                    {t("settings.access.ssoProvidersDescription")}
                </p>
            </div>

            {children ? <div className="mb-3">{children}</div> : null}

            <SettingsToolbar actions={addButton()} />
            <ListTable<OrganizationProvider>
                columns={columns}
                groups={[{key: "all", label: null, rows: providers}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.id}
                minWidth={0}
                onOpenRow={onEdit}
                loading={loading && providers.length === 0}
                hideHeader={!loading && providers.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("organization")}
                        title={t("settings.access.noSsoProvidersTitle")}
                        description={t("settings.access.noSsoProvidersDescription")}
                        action={addButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const url = callbackUrlFor?.(record)
                    const instructions =
                        renderInstructions && !isValid(record) ? renderInstructions(record) : null
                    return (
                        <>
                            <span className="truncate font-medium text-foreground">
                                {record.slug}
                            </span>
                            {!shows("callback_url") ? null : url ? (
                                <span
                                    className="truncate font-mono text-[13px] text-muted-foreground"
                                    title={url}
                                >
                                    {url}
                                </span>
                            ) : (
                                <span className="truncate text-muted-foreground">
                                    {t("settings.access.setOrgSlug")}
                                </span>
                            )}
                            {!isEnabled(record) ? (
                                <StatusIndicator label={t("common.disabled")} />
                            ) : isValid(record) ? (
                                <StatusIndicator tone="success" label={t("common.active")} />
                            ) : (
                                <StatusIndicator tone="warning" label={t("common.pending")} />
                            )}
                            {/* The row opens the edit drawer on click. A disabled button lets
                                the click through, so the cell stops it, not the button. */}
                            <span
                                className="flex justify-end"
                                onClick={(event) => event.stopPropagation()}
                            >
                                {(!isEnabled(record) || !isValid(record)) && onEnable ? (
                                    <Button disabled={enabling} onClick={() => onEnable(record)}>
                                        {t("common.enable")}
                                    </Button>
                                ) : null}
                            </span>
                            <SettingsRowMenu
                                label={t("settings.access.providerActions")}
                                items={[
                                    {
                                        key: "edit",
                                        label: t("settings.access.editProvider"),
                                        icon: <PencilSimpleLine size={14} />,
                                        hidden: !onEdit,
                                        onClick: () => onEdit?.(record),
                                    },
                                    {
                                        key: "delete",
                                        label: t("settings.access.deleteProvider"),
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !onDelete,
                                        disabled: deleting,
                                        onClick: () => onDelete?.(record),
                                    },
                                ]}
                            />
                            {instructions ? (
                                <div className="col-span-full">{instructions}</div>
                            ) : null}
                        </>
                    )
                }}
            />
        </section>
    )
}

import {useMemo, type ReactNode} from "react"

import type {OrganizationDomain} from "@agenta/entities/organization"
import {formatLocale, useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsAccessCatalog from "@agenta/i18n/catalogs/settings.access"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, Plus, Trash} from "@phosphor-icons/react"

import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {SettingsToolbar} from "../shared/SettingsToolbar"
import {usePhoneColumns} from "../shared/usePhoneColumns"

/** An unverified domain's token stops being usable 48 hours after it was issued. */
const TOKEN_LIFETIME_MS = 48 * 60 * 60 * 1000

const COLUMNS: (ListTableColumn & {
    label: CatalogKey<typeof commonCatalog | typeof settingsAccessCatalog>
})[] = [
    {key: "slug", label: "settings.access.domain", width: "minmax(0,2fr)"},
    {key: "expires_at", label: "settings.access.expiration", width: "minmax(0,1.4fr)"},
    {key: "is_verified", label: "common.status", width: "minmax(0,1fr)"},
    {key: "verify", label: "common.verify", srOnly: true, width: "72px"},
    {key: "actions", label: "common.actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["slug", "is_verified", "verify", "actions"]

const ExpirationCell = ({domain}: {domain: OrganizationDomain}) => {
    const t = useT(commonCatalog, settingsAccessCatalog)
    if (domain.flags?.is_verified) return <span className="text-muted-foreground">-</span>
    // An unparseable `created_at` is NaN, which reads as neither expired nor live: say so.
    const createdAt = new Date(domain.created_at).getTime()
    if (Number.isNaN(createdAt))
        return <span className="text-muted-foreground">{t("common.unknown")}</span>
    const expiresAt = new Date(createdAt + TOKEN_LIFETIME_MS)
    const expired = new Date() > expiresAt
    return (
        <span className={expired ? "truncate text-destructive" : "truncate text-muted-foreground"}>
            {expired
                ? t("settings.access.expiredDate", {
                      date: expiresAt.toLocaleString(formatLocale()),
                  })
                : expiresAt.toLocaleString(formatLocale())}
        </span>
    )
}

export interface DomainsSectionProps {
    domains: OrganizationDomain[]
    loading?: boolean
    onAdd?: () => void
    onVerify?: (domain: OrganizationDomain) => void
    onRefreshToken?: (domain: OrganizationDomain) => void
    onDelete?: (domain: OrganizationDomain) => void
    verifying?: boolean
    refreshing?: boolean
    deleting?: boolean
    /** Copy affordances differ per host, so the DNS rows are rendered by the caller. */
    renderInstructions?: (domain: OrganizationDomain) => ReactNode
}

/** Domains you have proven you own, and what is left to do for the ones you have not. */
export const DomainsSection = ({
    domains,
    loading = false,
    onAdd,
    onVerify,
    onRefreshToken,
    onDelete,
    verifying,
    refreshing,
    deleting,
    renderInstructions,
}: DomainsSectionProps) => {
    const t = useT(commonCatalog, settingsAccessCatalog)
    const translatedColumns = useMemo(
        () => COLUMNS.map((column) => ({...column, label: t(column.label)})),
        [t],
    )
    const {columns, shows} = usePhoneColumns(translatedColumns, PHONE_KEYS)
    const addButton = (variant?: "outline") =>
        onAdd ? (
            <Button variant={variant} onClick={onAdd} disabled={loading}>
                <Plus size={14} />
                {t("settings.access.addDomain")}
            </Button>
        ) : null

    return (
        <section className="flex flex-col">
            <div className="mb-3">
                <h2 className="m-0 text-[13px] font-medium leading-[18px] text-muted-foreground">
                    {t("settings.access.verifiedDomains")}
                </h2>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                    {t("settings.access.verifiedDomainsDescription")}
                </p>
            </div>

            <SettingsToolbar actions={addButton()} />
            <ListTable<OrganizationDomain>
                columns={columns}
                groups={[{key: "all", label: null, rows: domains}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.id}
                minWidth={0}
                loading={loading && domains.length === 0}
                hideHeader={!loading && domains.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("organization")}
                        title={t("settings.access.noDomainsTitle")}
                        description={t("settings.access.noDomainsDescription")}
                        action={addButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const verified = Boolean(record.flags?.is_verified)
                    const instructions =
                        renderInstructions && !verified && record.token
                            ? renderInstructions(record)
                            : null
                    return (
                        <>
                            <span className="truncate font-medium text-foreground">
                                {record.slug}
                            </span>
                            {shows("expires_at") ? <ExpirationCell domain={record} /> : null}
                            {verified ? (
                                <StatusIndicator tone="success" label={t("common.verified")} />
                            ) : (
                                <StatusIndicator tone="warning" label={t("common.pending")} />
                            )}
                            <span className="flex justify-end">
                                {!verified && onVerify ? (
                                    <Button disabled={verifying} onClick={() => onVerify(record)}>
                                        {t("common.verify")}
                                    </Button>
                                ) : null}
                            </span>
                            <SettingsRowMenu
                                label={t("settings.access.domainActions")}
                                items={[
                                    {
                                        key: "refresh",
                                        label: t("settings.access.refreshToken"),
                                        icon: <ArrowClockwise size={14} />,
                                        hidden: verified || !onRefreshToken,
                                        disabled: refreshing,
                                        onClick: () => onRefreshToken?.(record),
                                    },
                                    {
                                        key: "delete",
                                        label: t("settings.access.deleteDomain"),
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

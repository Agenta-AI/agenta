import {useMemo, useState, type ReactNode} from "react"

import type {Org} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n/settings"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowsLeftRight, Copy, PencilSimpleLine, Plus, SignOut, Trash} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {copyWithMessage} from "../shared/copyWithMessage"
import {hoverableRow} from "../shared/hoverableRow"
import {InlineName} from "../shared/InlineName"
import {NameAvatar} from "../shared/NameAvatar"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

interface OrgRow extends Org {
    key: string
}

const columnsFor = (t: ReturnType<typeof useT>): ListTableColumn[] => [
    {key: "name", label: t("settings.organizations.organization"), width: "minmax(0,2fr)"},
    {key: "status", label: t("common.status"), width: "minmax(0,1fr)"},
    {key: "owner_id", label: t("common.yourRole"), width: "minmax(0,1fr)"},
    {key: "actions", label: t("common.actions"), srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["name", "status", "actions"]

export interface OrganizationsPageProps {
    /** Every organization you belong to. */
    organizations: Org[]
    loading?: boolean
    /** Marks the "Current" row and scopes the ownership transfer. */
    selectedOrgId?: string | null
    currentUserId?: string | null
    onSwitch?: (org: Org) => void
    onCreate?: () => void
    /** Saves a new name typed in place on the row. */
    onRename?: (org: Org, name: string) => Promise<unknown>
    onTransferOwnership?: (org: Org) => void
    onLeave?: (org: Org) => void
    onDelete?: (org: Org) => void
    /** Create / rename / transfer / delete dialogs — the host's. */
    children?: ReactNode
}

/**
 * The organizations you belong to, which one you are in, and what you can do to each.
 *
 * A view only: the list and every verb come from the host, so a surface that brings no dialogs
 * still renders the list and its empty state.
 */
export const OrganizationsPage = ({
    organizations,
    loading = false,
    selectedOrgId,
    currentUserId,
    onSwitch,
    onCreate,
    onRename,
    onTransferOwnership,
    onLeave,
    onDelete,
    children,
}: OrganizationsPageProps) => {
    const t = useT()
    const rows = useMemo<OrgRow[]>(
        () => organizations.map((org) => ({...org, key: org.id})),
        [organizations],
    )

    const [renamingId, setRenamingId] = useState<string | null>(null)
    const {columns, shows} = usePhoneColumns(
        useMemo(() => columnsFor(t), [t]),
        PHONE_KEYS,
    )
    const isOwner = (org: Org) => Boolean(currentUserId) && org.owner_id === currentUserId

    const createButton = (variant?: "outline") =>
        onCreate ? (
            <Button variant={variant} onClick={onCreate} disabled={loading}>
                <Plus size={14} />
                {t("settings.organizations.newOrganization")}
            </Button>
        ) : null

    return (
        <div className="flex flex-col">
            <SettingsPageActions>{createButton()}</SettingsPageActions>
            <ListTable<OrgRow>
                columns={columns}
                groups={[{key: "all", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={0}
                density="compact"
                onOpenRow={
                    onSwitch
                        ? (record) => {
                              if (record.id !== selectedOrgId) onSwitch(record)
                          }
                        : undefined
                }
                loading={loading && rows.length === 0}
                hideHeader={!loading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("organizationGeneral")}
                        title={t("settings.organizations.emptyTitle")}
                        description={t("settings.organizations.emptyDescription")}
                        action={createButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const name = record.name ?? record.slug ?? record.id
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <NameAvatar name={name} />
                                <InlineName
                                    value={name}
                                    editing={renamingId === record.id}
                                    ariaLabel={t("settings.organizations.organizationName")}
                                    onDone={() => setRenamingId(null)}
                                    onSave={(next) => onRename?.(record, next) ?? Promise.resolve()}
                                />
                            </div>
                            <span className="flex min-w-0 items-center">
                                {record.id === selectedOrgId ? (
                                    <StatusIndicator
                                        tone="success"
                                        label={t("settings.organizations.current")}
                                        className="text-[13px]"
                                    />
                                ) : (
                                    <span className="text-muted-foreground">—</span>
                                )}
                            </span>
                            {shows("owner_id") ? (
                                <span className="truncate">
                                    {isOwner(record)
                                        ? t("settings.organizations.owner")
                                        : t("settings.organizations.member")}
                                </span>
                            ) : null}
                            <SettingsRowMenu
                                label={t("settings.organizations.organizationActions")}
                                items={[
                                    {
                                        key: "switch",
                                        label: t("settings.organizations.switchTo"),
                                        icon: <ArrowsLeftRight size={14} />,
                                        hidden: record.id === selectedOrgId || !onSwitch,
                                        onClick: () => onSwitch?.(record),
                                    },
                                    {
                                        key: "rename",
                                        label: t("common.rename"),
                                        icon: <PencilSimpleLine size={14} />,
                                        hidden: !isOwner(record) || !onRename,
                                        deferred: true,
                                        onClick: () => setRenamingId(record.id),
                                    },
                                    {
                                        key: "transfer",
                                        label: t("settings.organizations.transferOwnership"),
                                        icon: <ArrowsLeftRight size={14} />,
                                        // The member list is scoped to the current organization.
                                        hidden:
                                            !isOwner(record) ||
                                            record.id !== selectedOrgId ||
                                            !onTransferOwnership,
                                        onClick: () => onTransferOwnership?.(record),
                                    },
                                    {
                                        key: "copy-id",
                                        label: t("settings.organizations.copyId"),
                                        icon: <Copy size={14} />,
                                        onClick: () =>
                                            void copyWithMessage(
                                                record.id,
                                                t("settings.organizations.idCopied"),
                                                t("settings.organizations.copyIdFailed"),
                                            ),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "leave",
                                        label: t("settings.organizations.leave"),
                                        icon: <SignOut size={14} />,
                                        danger: true,
                                        hidden: isOwner(record) || !onLeave,
                                        onClick: () => onLeave?.(record),
                                    },
                                    {
                                        key: "delete",
                                        label: t("settings.organizations.delete"),
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !isOwner(record) || !onDelete,
                                        onClick: () => onDelete?.(record),
                                    },
                                ]}
                            />
                        </>
                    )
                }}
            />

            {children}
        </div>
    )
}
